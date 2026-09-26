-- 20260924110000_support_escalation_gateway.sql
--
-- Support Escalation Chain: the escalation gateway. Five SECURITY DEFINER
-- functions are the only code allowed to write across support owners
-- (tenant / partner / platform). Every function re-verifies the caller
-- itself — it never trusts that RLS or the client already checked — locks
-- the rows it changes before validating their state, and leaves nothing
-- changed on a failed call.
--
-- Design ref: docs/superpowers/specs/2026-09-24-support-escalation-chain-design.md
-- Schema ref: supabase/migrations/20260924100000_support_owner_escalation.sql
--
-- Owner hierarchy used below (confirmed against supabase/migrations/*):
-- Konnect's `tenants` table has no `parent_tenant_id` column, so there is
-- no subtenant hop. A tenant's parent is its partner (`partner_tenants`,
-- one partner per tenant) or, if it has none, the platform. A partner's
-- parent is always the platform. The platform has no parent.

-- ============================================================================
-- A. support_parent_owner — the direct parent of an owner, per the hierarchy
--    above. Zero rows for platform. Callable only by an owner member.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.support_parent_owner(p_scope text, p_tenant_id uuid, p_partner_id uuid)
RETURNS TABLE(owner_scope text, tenant_id uuid, partner_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;

  -- can_access_support_owner returns SQL NULL (not false) when the caller
  -- has no tenant of their own; COALESCE keeps this fail-closed.
  IF NOT COALESCE(public.can_access_support_owner(p_scope, p_tenant_id, p_partner_id), false) THEN
    RAISE EXCEPTION 'support: caller is not a member of the given owner';
  END IF;

  IF p_scope = 'platform' THEN
    RETURN; -- top of the chain: no parent
  ELSIF p_scope = 'partner' THEN
    RETURN QUERY SELECT 'platform'::text, NULL::uuid, NULL::uuid;
    RETURN;
  ELSIF p_scope = 'tenant' THEN
    SELECT pt.partner_id INTO v_partner_id
    FROM public.partner_tenants pt
    WHERE pt.tenant_id = p_tenant_id;

    IF v_partner_id IS NOT NULL THEN
      RETURN QUERY SELECT 'partner'::text, NULL::uuid, v_partner_id;
    ELSE
      RETURN QUERY SELECT 'platform'::text, NULL::uuid, NULL::uuid;
    END IF;
    RETURN;
  ELSE
    RAISE EXCEPTION 'support: unknown owner scope %', p_scope;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.support_parent_owner(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_parent_owner(text, uuid, uuid) TO authenticated;

-- ============================================================================
-- B. support_escalate — create the upstream ticket, copy chosen threads as
--    internal notes, link it to the downstream ticket, and move the
--    downstream ticket to waiting_on_upstream. Attachments are copied by
--    the host afterward; not handled here.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.support_escalate(
  p_downstream_ticket_id uuid,
  p_subject text,
  p_description text,
  p_priority text,
  p_support_code text,
  p_support_ref text,
  p_thread_messages text[],
  p_shared jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_downstream public.support_tickets%ROWTYPE;
  v_target_owner record;
  v_upstream public.support_tickets%ROWTYPE;
  v_link public.support_ticket_links%ROWTYPE;
  v_message text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;

  IF p_subject IS NULL OR btrim(p_subject) = '' THEN
    RAISE EXCEPTION 'support: subject is required';
  END IF;
  IF p_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN
    RAISE EXCEPTION 'support: invalid priority %', p_priority;
  END IF;

  -- Lock the downstream ticket before validating its state, so two
  -- concurrent escalations of the same ticket cannot both succeed.
  SELECT * INTO v_downstream FROM public.support_tickets WHERE id = p_downstream_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: downstream ticket % not found', p_downstream_ticket_id;
  END IF;

  -- can_access_support_owner returns SQL NULL (not false) when the caller
  -- has no tenant of their own; COALESCE keeps this fail-closed.
  IF NOT COALESCE(
    public.can_access_support_owner(v_downstream.owner_scope, v_downstream.tenant_id, v_downstream.partner_id), false
  ) THEN
    RAISE EXCEPTION 'support: caller is not a member of the downstream ticket''s owner';
  END IF;

  IF v_downstream.status NOT IN ('open', 'in_progress', 'waiting_on_customer') THEN
    RAISE EXCEPTION 'support: ticket % cannot be escalated from status %', v_downstream.ticket_number, v_downstream.status;
  END IF;

  -- The target owner is always computed here from the downstream ticket's
  -- own owner, never taken from the client.
  SELECT * INTO v_target_owner
  FROM public.support_parent_owner(v_downstream.owner_scope, v_downstream.tenant_id, v_downstream.partner_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: ticket % is already at the top of the support chain', v_downstream.ticket_number;
  END IF;

  INSERT INTO public.support_tickets (
    owner_scope, tenant_id, partner_id, subject, description, status, priority,
    category_id, group_id, assigned_to, created_by, support_code, support_ref
  ) VALUES (
    v_target_owner.owner_scope, v_target_owner.tenant_id, v_target_owner.partner_id,
    p_subject, p_description, 'open', p_priority,
    NULL, NULL, NULL, auth.uid(), p_support_code, p_support_ref
  )
  RETURNING * INTO v_upstream;

  IF p_thread_messages IS NOT NULL THEN
    FOREACH v_message IN ARRAY p_thread_messages
    LOOP
      INSERT INTO public.support_ticket_threads (ticket_id, user_id, message, is_internal)
      VALUES (v_upstream.id, auth.uid(), v_message, true);
    END LOOP;
  END IF;

  -- One active escalation per ticket is also enforced by
  -- support_ticket_links_one_active_escalation; the status check above
  -- already rejects a ticket that is already waiting_on_upstream.
  INSERT INTO public.support_ticket_links (
    kind, from_ticket_id, to_ticket_id, state, shared, created_by
  ) VALUES (
    'escalation', v_downstream.id, v_upstream.id, 'active', COALESCE(p_shared, '{}'::jsonb), auth.uid()
  )
  RETURNING * INTO v_link;

  UPDATE public.support_tickets SET status = 'waiting_on_upstream' WHERE id = v_downstream.id;

  INSERT INTO public.audit_logs (
    user_id, tenant_id, action, resource, resource_id, permission, allowed, category, severity, success, metadata
  ) VALUES (
    auth.uid(),
    CASE WHEN v_downstream.owner_scope = 'tenant' THEN v_downstream.tenant_id ELSE NULL END,
    'support.escalate', 'support_ticket_link', v_link.id::text, 'action', true, 'support', 'info', true,
    jsonb_build_object('downstream_ticket_id', v_downstream.id, 'upstream_ticket_id', v_upstream.id)
  );

  RETURN jsonb_build_object('upstream_ticket', to_jsonb(v_upstream), 'link', to_jsonb(v_link));
END;
$$;

REVOKE ALL ON FUNCTION public.support_escalate(uuid, text, text, text, text, text, text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_escalate(uuid, text, text, text, text, text, text[], jsonb) TO authenticated;

-- ============================================================================
-- C. support_hand_back — resolution or send-back for one or more escalation
--    links, applied by an upstream owner member. The upstream ticket must
--    already be resolved (for a resolution) or closed (for a send-back).
--    Returns only what downstream notifications need — never the downstream
--    description or requester, which the downstream owner did not share.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.support_hand_back(p_updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_update jsonb;
  v_link public.support_ticket_links%ROWTYPE;
  v_downstream public.support_tickets%ROWTYPE;
  v_upstream_status text;
  v_link_id uuid;
  v_link_state text;
  v_resolution text;
  v_note text;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'support: p_updates must be a jsonb array';
  END IF;

  FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    v_link_id := (v_update->>'link_id')::uuid;
    v_link_state := v_update->>'link_state';
    v_resolution := v_update->>'resolution';
    v_note := v_update->>'note';

    IF v_link_id IS NULL THEN
      RAISE EXCEPTION 'support: link_id is required';
    END IF;
    IF v_link_state NOT IN ('resolved', 'returned') THEN
      RAISE EXCEPTION 'support: link_state must be resolved or returned, got %', v_link_state;
    END IF;
    IF v_note IS NULL OR btrim(v_note) = '' THEN
      RAISE EXCEPTION 'support: note is required';
    END IF;
    IF v_link_state = 'resolved' AND (v_resolution IS NULL OR btrim(v_resolution) = '') THEN
      RAISE EXCEPTION 'support: a resolution is required';
    END IF;

    -- Lock the link before validating its state.
    SELECT * INTO v_link FROM public.support_ticket_links WHERE id = v_link_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'support: link % not found', v_link_id;
    END IF;
    IF v_link.kind <> 'escalation' OR v_link.state <> 'active' THEN
      RAISE EXCEPTION 'support: link % is not an active escalation', v_link_id;
    END IF;

    -- Caller must be a member of the UPSTREAM ticket's owner (to_ticket_id),
    -- not just the downstream ticket's requester or owner.
    IF v_link.to_ticket_id IS NULL OR NOT public.can_access_support_ticket(v_link.to_ticket_id) THEN
      RAISE EXCEPTION 'support: caller is not a member of the upstream ticket''s owner';
    END IF;

    SELECT status INTO v_upstream_status FROM public.support_tickets WHERE id = v_link.to_ticket_id;
    IF v_link_state = 'resolved' AND v_upstream_status NOT IN ('resolved', 'closed') THEN
      RAISE EXCEPTION 'support: resolve the upstream ticket before handing the resolution back';
    END IF;
    IF v_link_state = 'returned' AND v_upstream_status <> 'closed' THEN
      RAISE EXCEPTION 'support: close the upstream ticket before sending the escalation back';
    END IF;

    SELECT * INTO v_downstream FROM public.support_tickets WHERE id = v_link.from_ticket_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'support: downstream ticket % not found', v_link.from_ticket_id;
    END IF;

    UPDATE public.support_ticket_links
    SET state = v_link_state,
        resolution = CASE WHEN v_link_state = 'resolved' THEN v_resolution ELSE NULL END,
        closed_at = now()
    WHERE id = v_link.id;

    IF v_downstream.status = 'waiting_on_upstream' THEN
      UPDATE public.support_tickets SET status = 'in_progress' WHERE id = v_downstream.id;
    END IF;

    INSERT INTO public.support_ticket_threads (ticket_id, user_id, message, is_internal)
    VALUES (v_downstream.id, auth.uid(), v_note, true);

    SELECT * INTO v_downstream FROM public.support_tickets WHERE id = v_downstream.id;

    INSERT INTO public.audit_logs (
      user_id, tenant_id, action, resource, resource_id, permission, allowed, category, severity, success, metadata
    ) VALUES (
      auth.uid(),
      CASE WHEN v_downstream.owner_scope = 'tenant' THEN v_downstream.tenant_id ELSE NULL END,
      'support.hand_back', 'support_ticket_link', v_link.id::text, 'action', true, 'support', 'info', true,
      jsonb_build_object(
        'link_id', v_link.id, 'downstream_ticket_id', v_downstream.id,
        'upstream_ticket_id', v_link.to_ticket_id, 'link_state', v_link_state
      )
    );

    v_results := v_results || jsonb_build_object(
      'id', v_downstream.id,
      'ticket_number', v_downstream.ticket_number,
      'subject', v_downstream.subject,
      'status', v_downstream.status,
      'priority', v_downstream.priority,
      'assigned_to', v_downstream.assigned_to,
      'owner_scope', v_downstream.owner_scope,
      'tenant_id', v_downstream.tenant_id,
      'partner_id', v_downstream.partner_id
    );
  END LOOP;

  RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION public.support_hand_back(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_hand_back(jsonb) TO authenticated;

-- ============================================================================
-- D. support_withdraw — the downstream owner takes its escalation back.
--    Does not change the downstream ticket itself (the host's own store
--    does that after this call returns).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.support_withdraw(p_link_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link public.support_ticket_links%ROWTYPE;
  v_upstream public.support_tickets%ROWTYPE;
  v_downstream_owner_scope text;
  v_downstream_tenant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;
  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'support: note is required';
  END IF;

  -- Lock the link before validating its state.
  SELECT * INTO v_link FROM public.support_ticket_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: link % not found', p_link_id;
  END IF;
  IF v_link.kind <> 'escalation' OR v_link.state <> 'active' THEN
    RAISE EXCEPTION 'support: link % is not an active escalation', p_link_id;
  END IF;

  IF NOT public.can_access_support_ticket(v_link.from_ticket_id) THEN
    RAISE EXCEPTION 'support: caller is not a member of the downstream ticket''s owner';
  END IF;

  SELECT owner_scope, tenant_id INTO v_downstream_owner_scope, v_downstream_tenant_id
  FROM public.support_tickets WHERE id = v_link.from_ticket_id;

  SELECT * INTO v_upstream FROM public.support_tickets WHERE id = v_link.to_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: upstream ticket % not found', v_link.to_ticket_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.support_ticket_links
    WHERE kind = 'escalation' AND state = 'active' AND from_ticket_id = v_upstream.id
  ) THEN
    RAISE EXCEPTION 'support: the upstream ticket has its own active escalation; that must be dealt with first';
  END IF;

  UPDATE public.support_ticket_links
  SET state = 'withdrawn', closed_at = now()
  WHERE id = v_link.id;

  UPDATE public.support_tickets SET status = 'closed' WHERE id = v_upstream.id;

  INSERT INTO public.support_ticket_threads (ticket_id, user_id, message, is_internal)
  VALUES (v_upstream.id, auth.uid(), p_note, true);

  INSERT INTO public.audit_logs (
    user_id, tenant_id, action, resource, resource_id, permission, allowed, category, severity, success, metadata
  ) VALUES (
    auth.uid(),
    CASE WHEN v_downstream_owner_scope = 'tenant' THEN v_downstream_tenant_id ELSE NULL END,
    'support.withdraw', 'support_ticket_link', v_link.id::text, 'action', true, 'support', 'info', true,
    jsonb_build_object('downstream_ticket_id', v_link.from_ticket_id, 'upstream_ticket_id', v_upstream.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.support_withdraw(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_withdraw(uuid, text) TO authenticated;

-- ============================================================================
-- E. support_merge — merge a duplicate ticket into a master owned by the
--    same owner; every active inbound escalation on the duplicate is
--    re-pointed to the master so resolving the master reaches every
--    original downstream ticket.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.support_merge(p_duplicate_ticket_id uuid, p_master_ticket_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dup public.support_tickets%ROWTYPE;
  v_master public.support_tickets%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;
  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'support: note is required';
  END IF;
  IF p_duplicate_ticket_id = p_master_ticket_id THEN
    RAISE EXCEPTION 'support: a ticket cannot be merged into itself';
  END IF;

  -- Lock both tickets, in a stable order, before validating their state.
  IF p_duplicate_ticket_id < p_master_ticket_id THEN
    SELECT * INTO v_dup FROM public.support_tickets WHERE id = p_duplicate_ticket_id FOR UPDATE;
    SELECT * INTO v_master FROM public.support_tickets WHERE id = p_master_ticket_id FOR UPDATE;
  ELSE
    SELECT * INTO v_master FROM public.support_tickets WHERE id = p_master_ticket_id FOR UPDATE;
    SELECT * INTO v_dup FROM public.support_tickets WHERE id = p_duplicate_ticket_id FOR UPDATE;
  END IF;

  IF v_dup.id IS NULL THEN
    RAISE EXCEPTION 'support: duplicate ticket % not found', p_duplicate_ticket_id;
  END IF;
  IF v_master.id IS NULL THEN
    RAISE EXCEPTION 'support: master ticket % not found', p_master_ticket_id;
  END IF;

  IF v_dup.owner_scope IS DISTINCT FROM v_master.owner_scope
     OR v_dup.tenant_id IS DISTINCT FROM v_master.tenant_id
     OR v_dup.partner_id IS DISTINCT FROM v_master.partner_id THEN
    RAISE EXCEPTION 'support: only tickets in the same queue can be merged';
  END IF;

  -- can_access_support_owner returns SQL NULL (not false) when the caller
  -- has no tenant of their own; COALESCE keeps this fail-closed.
  IF NOT COALESCE(public.can_access_support_owner(v_dup.owner_scope, v_dup.tenant_id, v_dup.partner_id), false) THEN
    RAISE EXCEPTION 'support: caller is not a member of this owner';
  END IF;

  IF v_dup.status IN ('closed', 'waiting_on_upstream') THEN
    RAISE EXCEPTION 'support: duplicate ticket % cannot be merged (status %)', v_dup.ticket_number, v_dup.status;
  END IF;
  IF v_master.status IN ('resolved', 'closed') THEN
    RAISE EXCEPTION 'support: master ticket % cannot receive a merge (status %)', v_master.ticket_number, v_master.status;
  END IF;

  -- The set of links to re-point is decided here, from the database, never
  -- from a client-supplied list.
  UPDATE public.support_ticket_links
  SET to_ticket_id = v_master.id
  WHERE kind = 'escalation' AND state = 'active' AND to_ticket_id = v_dup.id;

  INSERT INTO public.support_ticket_links (kind, from_ticket_id, to_ticket_id, state, created_by)
  VALUES ('merge', v_dup.id, v_master.id, 'active', auth.uid());

  UPDATE public.support_tickets SET status = 'closed' WHERE id = v_dup.id;

  INSERT INTO public.support_ticket_threads (ticket_id, user_id, message, is_internal)
  VALUES (v_dup.id, auth.uid(), p_note, true);

  INSERT INTO public.audit_logs (
    user_id, tenant_id, action, resource, resource_id, permission, allowed, category, severity, success, metadata
  ) VALUES (
    auth.uid(),
    CASE WHEN v_dup.owner_scope = 'tenant' THEN v_dup.tenant_id ELSE NULL END,
    'support.merge', 'support_ticket', v_master.id::text, 'action', true, 'support', 'info', true,
    jsonb_build_object('duplicate_ticket_id', v_dup.id, 'master_ticket_id', v_master.id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.support_merge(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_merge(uuid, uuid, text) TO authenticated;
