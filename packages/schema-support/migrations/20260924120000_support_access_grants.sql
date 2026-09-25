-- 20260924120000_support_access_grants.sql
--
-- Support Escalation Chain: support access grants (option C). Staff above an
-- owner (its partner, or the platform) can read that owner's tickets only
-- through a consented, time-boxed, read-only, logged grant. No table policy
-- ever lets the grantee touch support_tickets/threads/attachments directly:
-- every read goes through the SECURITY DEFINER functions below, and every
-- one of them logs exactly one support_access_events row.
--
-- Design ref: docs/superpowers/specs/2026-09-24-support-escalation-chain-design.md
--   ("Support access (option C, decided 2026-09-24)")
-- Style ref: supabase/migrations/20260924110000_support_escalation_gateway.sql
--   (SET search_path, auth.uid() IS NULL guard, COALESCE on every boolean
--   helper, row locks before validating state, one audit_logs row per
--   lifecycle action, REVOKE ALL ... FROM PUBLIC, anon; GRANT ... TO
--   authenticated, every exception message starts with "support:").

-- ============================================================================
-- 1. Tables
-- ============================================================================
CREATE TABLE IF NOT EXISTS support_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner: whose tickets this grant is about. Never 'platform' -- nothing
  -- sits above the platform queue.
  owner_scope text NOT NULL CHECK (owner_scope IN ('tenant', 'partner')),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,

  -- Grantee: who gets to read. 'partner' grantees name the partner.
  grantee_scope text NOT NULL CHECK (grantee_scope IN ('partner', 'platform')),
  grantee_partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,

  -- Scope: one ticket, or null for the whole queue. Must belong to the owner
  -- (enforced by the functions below, not by a table CHECK).
  ticket_id uuid REFERENCES support_tickets(id) ON DELETE CASCADE,

  kind text NOT NULL CHECK (kind IN ('request', 'grant', 'break_glass')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'revoked')),

  reason text NOT NULL CHECK (btrim(reason) <> ''),
  requested_hours int NOT NULL CHECK (requested_hours BETWEEN 1 AND 168),

  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),

  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,

  starts_at timestamptz,
  expires_at timestamptz,

  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,

  CONSTRAINT support_access_grants_exactly_one_owner CHECK (
    (owner_scope = 'tenant'  AND tenant_id IS NOT NULL AND partner_id IS NULL) OR
    (owner_scope = 'partner' AND partner_id IS NOT NULL AND tenant_id IS NULL)
  ),
  CONSTRAINT support_access_grants_grantee_check CHECK (
    (grantee_scope = 'platform' AND grantee_partner_id IS NULL) OR
    (grantee_scope = 'partner'  AND grantee_partner_id IS NOT NULL)
  ),
  CONSTRAINT support_access_grants_approved_has_window CHECK (
    status <> 'approved' OR (starts_at IS NOT NULL AND expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_support_access_grants_tenant_id ON support_access_grants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_access_grants_partner_id ON support_access_grants(partner_id);
CREATE INDEX IF NOT EXISTS idx_support_access_grants_grantee_partner_id ON support_access_grants(grantee_partner_id);
CREATE INDEX IF NOT EXISTS idx_support_access_grants_ticket_id ON support_access_grants(ticket_id);

-- Append-only. No update_by/updated_at: every write goes through one of the
-- functions below, which each write their own decided_at/revoked_at.
CREATE TABLE IF NOT EXISTS support_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES support_access_grants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('list_tickets', 'view_ticket', 'download_attachment')),
  -- Plain ids, not foreign keys: the log keeps its record of what was read
  -- even after the ticket or attachment is deleted.
  ticket_id uuid,
  attachment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_access_events_grant_id ON support_access_events(grant_id);

-- ============================================================================
-- 2. Immutability / append-only triggers
-- ============================================================================

-- Grants: owner, grantee, ticket, kind and requested_by never change after
-- insert. Lifecycle transitions (status, decided_*, starts_at/expires_at,
-- revoked_*) go through the functions below, which never touch these columns.
CREATE OR REPLACE FUNCTION public.support_access_grants_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.owner_scope IS DISTINCT FROM OLD.owner_scope
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
     OR NEW.grantee_scope IS DISTINCT FROM OLD.grantee_scope
     OR NEW.grantee_partner_id IS DISTINCT FROM OLD.grantee_partner_id
     OR NEW.ticket_id IS DISTINCT FROM OLD.ticket_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     -- requested_by may only become NULL (ON DELETE SET NULL when the user is deleted).
     OR (NEW.requested_by IS DISTINCT FROM OLD.requested_by AND NEW.requested_by IS NOT NULL) THEN
    RAISE EXCEPTION 'support: grant owner, grantee, ticket, kind and requested_by are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_access_grants_immutable ON support_access_grants;
CREATE TRIGGER support_access_grants_immutable
  BEFORE UPDATE ON support_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.support_access_grants_identity_immutable();

-- Events: append-only for everyone, including service_role (RLS is not
-- enough for that -- service_role bypasses RLS entirely -- so this is a
-- trigger, which fires regardless of role). The one exception is a
-- referential action (pg_trigger_depth() > 1: fired from inside the foreign
-- key's own trigger): the grant's ON DELETE CASCADE and actor_id's
-- ON DELETE SET NULL, so deleting a tenant, partner or user still works.
CREATE OR REPLACE FUNCTION public.support_access_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'support: support_access_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS support_access_events_no_update ON support_access_events;
CREATE TRIGGER support_access_events_no_update
  BEFORE UPDATE ON support_access_events
  FOR EACH ROW EXECUTE FUNCTION public.support_access_events_append_only();

DROP TRIGGER IF EXISTS support_access_events_no_delete ON support_access_events;
CREATE TRIGGER support_access_events_no_delete
  BEFORE DELETE ON support_access_events
  FOR EACH ROW EXECUTE FUNCTION public.support_access_events_append_only();

-- ============================================================================
-- 3. Helpers (SECURITY DEFINER, STABLE, COALESCE'd to false)
-- ============================================================================

-- The owner-side admin for a grant: Tenant Admin / Organization Admin of the
-- tenant, or Partner Admin of the partner.
CREATE OR REPLACE FUNCTION public.support_is_owner_admin(p_scope text, p_tenant uuid, p_partner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(CASE p_scope
    WHEN 'tenant' THEN
      p_tenant = public.support_member_tenant_id()
      AND EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.roles r ON r.id = u.role_id
        WHERE u.id = auth.uid() AND r.name IN ('Tenant Admin', 'Organization Admin')
      )
    WHEN 'partner' THEN
      public.current_user_is_partner_admin() AND p_partner = public.get_current_user_partner_id()
    ELSE false
  END, false);
$$;
GRANT EXECUTE ON FUNCTION public.support_is_owner_admin(text, uuid, uuid) TO authenticated;

-- A member of the grantee side: the platform operator, or the Partner Admin
-- of the named partner.
CREATE OR REPLACE FUNCTION public.support_is_grantee_member(p_grantee_scope text, p_grantee_partner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(CASE p_grantee_scope
    WHEN 'platform' THEN public.is_support_platform_operator()
    WHEN 'partner' THEN public.current_user_is_partner_admin() AND p_grantee_partner = public.get_current_user_partner_id()
    ELSE false
  END, false);
$$;
GRANT EXECUTE ON FUNCTION public.support_is_grantee_member(text, uuid) TO authenticated;

-- A grant is active for the CALLING user right now: approved, within its
-- time window, the caller is a member of its grantee, and a partner grantee
-- still manages the tenant (access ends the moment the partner link does).
CREATE OR REPLACE FUNCTION public.support_access_grant_active(p_grant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT g.status = 'approved'
        AND g.starts_at <= now()
        AND now() < g.expires_at
        AND public.support_is_grantee_member(g.grantee_scope, g.grantee_partner_id)
        AND (
          g.grantee_scope <> 'partner'
          OR EXISTS (
            SELECT 1 FROM public.partner_tenants pt
            WHERE pt.partner_id = g.grantee_partner_id AND pt.tenant_id = g.tenant_id
          )
        )
      FROM public.support_access_grants g
      WHERE g.id = p_grant_id
    ),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.support_access_grant_active(uuid) TO authenticated;

-- RLS helper for support_access_events: is the parent grant visible to the
-- caller (owner member or grantee member)? SECURITY DEFINER so the events
-- policy doesn't depend on the grants table's own RLS evaluation.
CREATE OR REPLACE FUNCTION public.support_access_grant_visible(p_grant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_access_grants g
    WHERE g.id = p_grant_id
      AND (
        public.can_access_support_owner(g.owner_scope, g.tenant_id, g.partner_id)
        OR public.support_is_grantee_member(g.grantee_scope, g.grantee_partner_id)
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.support_access_grant_visible(uuid) TO authenticated;

-- ============================================================================
-- 4. RLS -- SELECT only. Every write goes through the functions in section 5.
-- ============================================================================
ALTER TABLE support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner or grantee members can view access grants" ON support_access_grants;
CREATE POLICY "Owner or grantee members can view access grants"
  ON support_access_grants FOR SELECT
  USING (
    public.can_access_support_owner(owner_scope, tenant_id, partner_id)
    OR public.support_is_grantee_member(grantee_scope, grantee_partner_id)
  );

DROP POLICY IF EXISTS "Grant members can view access events" ON support_access_events;
CREATE POLICY "Grant members can view access events"
  ON support_access_events FOR SELECT
  USING (public.support_access_grant_visible(grant_id));

-- ============================================================================
-- 5. Functions (SECURITY DEFINER, REVOKE FROM PUBLIC, anon; GRANT TO authenticated)
-- ============================================================================

-- support_access_request: a grantee member (derived from the caller) asks
-- for access to an owner's queue or one ticket in it.
CREATE OR REPLACE FUNCTION public.support_access_request(
  p_owner_scope text,
  p_tenant_id uuid,
  p_partner_id uuid,
  p_ticket_number text,
  p_reason text,
  p_hours int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grantee_scope text;
  v_grantee_partner_id uuid;
  v_ticket_id uuid;
  v_reason text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;

  -- Grantee is derived from the caller, never taken from the client.
  IF COALESCE(public.is_support_platform_operator(), false) THEN
    v_grantee_scope := 'platform';
    v_grantee_partner_id := NULL;
  ELSIF COALESCE(public.current_user_is_partner_admin(), false) THEN
    v_grantee_scope := 'partner';
    v_grantee_partner_id := public.get_current_user_partner_id();
  ELSE
    RAISE EXCEPTION 'support: caller must be a platform operator or a partner admin';
  END IF;

  IF p_owner_scope = 'tenant' THEN
    IF p_tenant_id IS NULL OR p_partner_id IS NOT NULL THEN
      RAISE EXCEPTION 'support: a tenant owner requires tenant_id and no partner_id';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
      RAISE EXCEPTION 'support: tenant % not found', p_tenant_id;
    END IF;
  ELSIF p_owner_scope = 'partner' THEN
    IF p_partner_id IS NULL OR p_tenant_id IS NOT NULL THEN
      RAISE EXCEPTION 'support: a partner owner requires partner_id and no tenant_id';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id) THEN
      RAISE EXCEPTION 'support: partner % not found', p_partner_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'support: owner scope must be tenant or partner, got %', p_owner_scope;
  END IF;

  -- A partner grantee may only target a tenant it manages: never a partner
  -- owner (no partner-to-partner grants), never its own queue.
  IF v_grantee_scope = 'partner' THEN
    IF p_owner_scope <> 'tenant' THEN
      RAISE EXCEPTION 'support: a partner may only request access to a managed tenant';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.partner_tenants pt
      WHERE pt.tenant_id = p_tenant_id AND pt.partner_id = v_grantee_partner_id
    ) THEN
      RAISE EXCEPTION 'support: partner does not manage tenant %', p_tenant_id;
    END IF;
  END IF;

  -- The caller must not already be a member of the owner it is requesting
  -- access to.
  IF COALESCE(public.can_access_support_owner(p_owner_scope, p_tenant_id, p_partner_id), false) THEN
    RAISE EXCEPTION 'support: caller is already a member of this owner';
  END IF;

  IF p_ticket_number IS NULL THEN
    v_ticket_id := NULL;
  ELSE
    SELECT id INTO v_ticket_id FROM public.support_tickets
    WHERE owner_scope = p_owner_scope
      AND tenant_id IS NOT DISTINCT FROM p_tenant_id
      AND partner_id IS NOT DISTINCT FROM p_partner_id
      AND ticket_number = p_ticket_number;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'support: ticket % not found in this owner''s queue', p_ticket_number;
    END IF;
  END IF;

  v_reason := btrim(p_reason);
  IF v_reason IS NULL OR v_reason = '' THEN
    RAISE EXCEPTION 'support: a reason is required';
  END IF;
  IF p_hours IS NULL OR p_hours < 1 OR p_hours > 168 THEN
    RAISE EXCEPTION 'support: hours must be between 1 and 168';
  END IF;

  INSERT INTO public.support_access_grants (
    owner_scope, tenant_id, partner_id, grantee_scope, grantee_partner_id,
    ticket_id, kind, status, reason, requested_hours, requested_by
  ) VALUES (
    p_owner_scope, p_tenant_id, p_partner_id, v_grantee_scope, v_grantee_partner_id,
    v_ticket_id, 'request', 'pending', v_reason, p_hours, auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (
    user_id, tenant_id, action, resource, resource_id, permission, allowed, category, severity, success, metadata
  ) VALUES (
    auth.uid(), CASE WHEN p_owner_scope = 'tenant' THEN p_tenant_id ELSE NULL END,
    'support_access.request', 'support_access_grant', v_id::text, 'action', true, 'support', 'info', true,
    jsonb_build_object(
      'grantee', jsonb_build_object('scope', v_grantee_scope, 'partner_id', v_grantee_partner_id),
      'ticket_id', v_ticket_id, 'hours', p_hours, 'kind', 'request'
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.support_access_request(text, uuid, uuid, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_request(text, uuid, uuid, text, text, int) TO authenticated;

-- support_access_grant: an owner admin directly grants access to its own
-- queue (no approval step; the owner is the one granting).
CREATE OR REPLACE FUNCTION public.support_access_grant(
  p_grantee_scope text,
  p_grantee_partner_id uuid,
  p_ticket_id uuid,
  p_reason text,
  p_hours int
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_scope text;
  v_owner_tenant uuid;
  v_owner_partner uuid;
  v_caller_tenant uuid;
  v_reason text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;

  -- Owner is the caller's own owner, never taken from the client.
  SELECT tenant_id INTO v_caller_tenant FROM public.users WHERE id = auth.uid();

  IF v_caller_tenant IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid() AND r.name IN ('Tenant Admin', 'Organization Admin')
  ) THEN
    v_owner_scope := 'tenant';
    v_owner_tenant := v_caller_tenant;
  ELSIF COALESCE(public.current_user_is_partner_admin(), false) THEN
    v_owner_scope := 'partner';
    v_owner_partner := public.get_current_user_partner_id();
  ELSE
    RAISE EXCEPTION 'support: caller must be a tenant admin or a partner admin';
  END IF;

  IF p_grantee_scope = 'platform' THEN
    IF p_grantee_partner_id IS NOT NULL THEN
      RAISE EXCEPTION 'support: a platform grantee must not specify a partner id';
    END IF;
  ELSIF p_grantee_scope = 'partner' THEN
    IF p_grantee_partner_id IS NULL THEN
      RAISE EXCEPTION 'support: a partner grantee requires a partner id';
    END IF;
    IF v_owner_scope <> 'tenant' THEN
      RAISE EXCEPTION 'support: only a tenant owner can grant access to a partner';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.partner_tenants pt
      WHERE pt.tenant_id = v_owner_tenant AND pt.partner_id = p_grantee_partner_id
    ) THEN
      RAISE EXCEPTION 'support: partner % does not manage this tenant', p_grantee_partner_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'support: grantee scope must be partner or platform, got %', p_grantee_scope;
  END IF;

  IF p_ticket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = p_ticket_id AND t.owner_scope = v_owner_scope
      AND t.tenant_id IS NOT DISTINCT FROM v_owner_tenant
      AND t.partner_id IS NOT DISTINCT FROM v_owner_partner
  ) THEN
    RAISE EXCEPTION 'support: ticket % does not belong to this owner', p_ticket_id;
  END IF;

  v_reason := btrim(p_reason);
  IF v_reason IS NULL OR v_reason = '' THEN
    RAISE EXCEPTION 'support: a reason is required';
  END IF;
  IF p_hours IS NULL OR p_hours < 1 OR p_hours > 168 THEN
    RAISE EXCEPTION 'support: hours must be between 1 and 168';
  END IF;

  INSERT INTO public.support_access_grants (
    owner_scope, tenant_id, partner_id, grantee_scope, grantee_partner_id,
    ticket_id, kind, status, reason, requested_hours,
    requested_by, decided_by, decided_at, starts_at, expires_at
  ) VALUES (
    v_owner_scope, v_owner_tenant, v_owner_partner, p_grantee_scope, p_grantee_partner_id,
    p_ticket_id, 'grant', 'approved', v_reason, p_hours,
    auth.uid(), auth.uid(), now(), now(), now() + make_interval(hours => p_hours)
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (
    user_id, tenant_id, action, resource, resource_id, permission, allowed, category, severity, success, metadata
  ) VALUES (
    auth.uid(), CASE WHEN v_owner_scope = 'tenant' THEN v_owner_tenant ELSE NULL END,
    'support_access.grant', 'support_access_grant', v_id::text, 'action', true, 'support', 'info', true,
    jsonb_build_object(
      'grantee', jsonb_build_object('scope', p_grantee_scope, 'partner_id', p_grantee_partner_id),
      'ticket_id', p_ticket_id, 'hours', p_hours, 'kind', 'grant'
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.support_access_grant(text, uuid, uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_grant(text, uuid, uuid, text, int) TO authenticated;

-- support_access_decide: the owner admin approves or denies a pending request.
CREATE OR REPLACE FUNCTION public.support_access_decide(p_grant_id uuid, p_approve boolean, p_hours int, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grant public.support_access_grants%ROWTYPE;
  v_hours int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'support: approve must be true or false';
  END IF;

  -- Lock the grant before validating its state.
  SELECT * INTO v_grant FROM public.support_access_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: grant % not found', p_grant_id;
  END IF;
  IF v_grant.status <> 'pending' THEN
    RAISE EXCEPTION 'support: grant % is not pending', p_grant_id;
  END IF;

  IF NOT COALESCE(public.support_is_owner_admin(v_grant.owner_scope, v_grant.tenant_id, v_grant.partner_id), false) THEN
    RAISE EXCEPTION 'support: caller is not an admin of this grant''s owner';
  END IF;

  IF p_approve THEN
    v_hours := COALESCE(p_hours, v_grant.requested_hours);
    IF v_hours < 1 OR v_hours > v_grant.requested_hours THEN
      RAISE EXCEPTION 'support: approved hours must be between 1 and the requested % hours', v_grant.requested_hours;
    END IF;

    UPDATE public.support_access_grants
    SET status = 'approved',
        starts_at = now(),
        expires_at = now() + make_interval(hours => v_hours),
        decided_by = auth.uid(),
        decided_at = now(),
        decision_note = p_note
    WHERE id = p_grant_id;

    INSERT INTO public.audit_logs (
      user_id, tenant_id, action, resource, resource_id, permission, allowed, category, severity, success, metadata
    ) VALUES (
      auth.uid(), CASE WHEN v_grant.owner_scope = 'tenant' THEN v_grant.tenant_id ELSE NULL END,
      'support_access.approve', 'support_access_grant', p_grant_id::text, 'action', true, 'support', 'info', true,
      jsonb_build_object(
        'grantee', jsonb_build_object('scope', v_grant.grantee_scope, 'partner_id', v_grant.grantee_partner_id),
        'ticket_id', v_grant.ticket_id, 'hours', v_hours, 'kind', v_grant.kind
      )
    );
  ELSE
    UPDATE public.support_access_grants
    SET status = 'denied',
        decided_by = auth.uid(),
        decided_at = now(),
        decision_note = p_note
    WHERE id = p_grant_id;

    INSERT INTO public.audit_logs (
      user_id, tenant_id, action, resource, resource_id, permission, allowed, category, severity, success, metadata
    ) VALUES (
      auth.uid(), CASE WHEN v_grant.owner_scope = 'tenant' THEN v_grant.tenant_id ELSE NULL END,
      'support_access.deny', 'support_access_grant', p_grant_id::text, 'action', true, 'support', 'info', true,
      jsonb_build_object(
        'grantee', jsonb_build_object('scope', v_grant.grantee_scope, 'partner_id', v_grant.grantee_partner_id),
        'ticket_id', v_grant.ticket_id, 'hours', v_grant.requested_hours, 'kind', v_grant.kind
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.support_access_decide(uuid, boolean, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_decide(uuid, boolean, int, text) TO authenticated;

-- support_access_revoke: the owner admin or the grantee ends a pending or
-- approved grant early.
CREATE OR REPLACE FUNCTION public.support_access_revoke(p_grant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grant public.support_access_grants%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;

  -- Lock the grant before validating its state.
  SELECT * INTO v_grant FROM public.support_access_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: grant % not found', p_grant_id;
  END IF;
  IF v_grant.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'support: grant % cannot be revoked from status %', p_grant_id, v_grant.status;
  END IF;

  IF NOT (
    COALESCE(public.support_is_owner_admin(v_grant.owner_scope, v_grant.tenant_id, v_grant.partner_id), false)
    OR COALESCE(public.support_is_grantee_member(v_grant.grantee_scope, v_grant.grantee_partner_id), false)
  ) THEN
    RAISE EXCEPTION 'support: caller is not an owner admin or grantee member of this grant';
  END IF;

  UPDATE public.support_access_grants
  SET status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
  WHERE id = p_grant_id;

  INSERT INTO public.audit_logs (
    user_id, tenant_id, action, resource, resource_id, permission, allowed, category, severity, success, metadata
  ) VALUES (
    auth.uid(), CASE WHEN v_grant.owner_scope = 'tenant' THEN v_grant.tenant_id ELSE NULL END,
    'support_access.revoke', 'support_access_grant', p_grant_id::text, 'action', true, 'support', 'info', true,
    jsonb_build_object(
      'grantee', jsonb_build_object('scope', v_grant.grantee_scope, 'partner_id', v_grant.grantee_partner_id),
      'ticket_id', v_grant.ticket_id, 'hours', v_grant.requested_hours, 'kind', v_grant.kind
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.support_access_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_revoke(uuid) TO authenticated;

-- support_access_break_glass: platform operators only, active immediately
-- for 1 hour, flagged with a higher-than-info audit severity.
CREATE OR REPLACE FUNCTION public.support_access_break_glass(
  p_owner_scope text,
  p_tenant_id uuid,
  p_partner_id uuid,
  p_ticket_number text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text;
  v_ticket_id uuid;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;
  IF NOT COALESCE(public.is_support_platform_operator(), false) THEN
    RAISE EXCEPTION 'support: break-glass access is platform operators only';
  END IF;

  v_reason := btrim(p_reason);
  IF v_reason IS NULL OR length(v_reason) < 20 THEN
    RAISE EXCEPTION 'support: break-glass needs a reason of at least 20 characters';
  END IF;

  IF p_owner_scope = 'tenant' THEN
    IF p_tenant_id IS NULL OR p_partner_id IS NOT NULL THEN
      RAISE EXCEPTION 'support: a tenant owner requires tenant_id and no partner_id';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
      RAISE EXCEPTION 'support: tenant % not found', p_tenant_id;
    END IF;
  ELSIF p_owner_scope = 'partner' THEN
    IF p_partner_id IS NULL OR p_tenant_id IS NOT NULL THEN
      RAISE EXCEPTION 'support: a partner owner requires partner_id and no tenant_id';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.partners WHERE id = p_partner_id) THEN
      RAISE EXCEPTION 'support: partner % not found', p_partner_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'support: owner scope must be tenant or partner, got %', p_owner_scope;
  END IF;

  IF p_ticket_number IS NULL THEN
    v_ticket_id := NULL;
  ELSE
    SELECT id INTO v_ticket_id FROM public.support_tickets
    WHERE owner_scope = p_owner_scope
      AND tenant_id IS NOT DISTINCT FROM p_tenant_id
      AND partner_id IS NOT DISTINCT FROM p_partner_id
      AND ticket_number = p_ticket_number;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'support: ticket % not found in this owner''s queue', p_ticket_number;
    END IF;
  END IF;

  INSERT INTO public.support_access_grants (
    owner_scope, tenant_id, partner_id, grantee_scope, grantee_partner_id,
    ticket_id, kind, status, reason, requested_hours,
    requested_by, decided_by, decided_at, starts_at, expires_at
  ) VALUES (
    p_owner_scope, p_tenant_id, p_partner_id, 'platform', NULL,
    v_ticket_id, 'break_glass', 'approved', v_reason, 1,
    auth.uid(), auth.uid(), now(), now(), now() + interval '1 hour'
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (
    user_id, tenant_id, action, resource, resource_id, permission, allowed, category, severity, success, metadata
  ) VALUES (
    auth.uid(), CASE WHEN p_owner_scope = 'tenant' THEN p_tenant_id ELSE NULL END,
    'support_access.break_glass', 'support_access_grant', v_id::text, 'action', true, 'support', 'warning', true,
    jsonb_build_object(
      'grantee', jsonb_build_object('scope', 'platform', 'partner_id', NULL),
      'ticket_id', v_ticket_id, 'hours', 1, 'kind', 'break_glass'
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.support_access_break_glass(text, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_break_glass(text, uuid, uuid, text, text) TO authenticated;

-- support_access_list_tickets: the grantee's read of the owner's queue (or
-- its one ticket). plpgsql + RETURN QUERY so the event insert (a side
-- effect) and the SETOF result can live in the same function.
CREATE OR REPLACE FUNCTION public.support_access_list_tickets(p_grant_id uuid)
RETURNS SETOF support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grant public.support_access_grants%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;
  IF NOT COALESCE(public.support_access_grant_active(p_grant_id), false) THEN
    RAISE EXCEPTION 'support: grant % is not active', p_grant_id;
  END IF;

  SELECT * INTO v_grant FROM public.support_access_grants WHERE id = p_grant_id;

  INSERT INTO public.support_access_events (grant_id, actor_id, action)
  VALUES (p_grant_id, auth.uid(), 'list_tickets');

  RETURN QUERY
  SELECT t.* FROM public.support_tickets t
  WHERE t.owner_scope = v_grant.owner_scope
    AND t.tenant_id IS NOT DISTINCT FROM v_grant.tenant_id
    AND t.partner_id IS NOT DISTINCT FROM v_grant.partner_id
    AND (v_grant.ticket_id IS NULL OR t.id = v_grant.ticket_id)
  ORDER BY t.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.support_access_list_tickets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_list_tickets(uuid) TO authenticated;

-- support_access_get_ticket: one ticket, its threads (internal notes
-- included -- the owner consented to that when it granted access) and
-- attachments.
CREATE OR REPLACE FUNCTION public.support_access_get_ticket(p_grant_id uuid, p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grant public.support_access_grants%ROWTYPE;
  v_ticket public.support_tickets%ROWTYPE;
  v_threads jsonb;
  v_attachments jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;
  IF NOT COALESCE(public.support_access_grant_active(p_grant_id), false) THEN
    RAISE EXCEPTION 'support: grant % is not active', p_grant_id;
  END IF;

  SELECT * INTO v_grant FROM public.support_access_grants WHERE id = p_grant_id;

  IF v_grant.ticket_id IS NOT NULL AND v_grant.ticket_id <> p_ticket_id THEN
    RAISE EXCEPTION 'support: ticket % is outside this grant''s scope', p_ticket_id;
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets t
  WHERE t.id = p_ticket_id
    AND t.owner_scope = v_grant.owner_scope
    AND t.tenant_id IS NOT DISTINCT FROM v_grant.tenant_id
    AND t.partner_id IS NOT DISTINCT FROM v_grant.partner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: ticket % not found in this grant''s owner', p_ticket_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(th) ORDER BY th.created_at), '[]'::jsonb) INTO v_threads
  FROM public.support_ticket_threads th WHERE th.ticket_id = v_ticket.id;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at), '[]'::jsonb) INTO v_attachments
  FROM public.support_ticket_attachments a WHERE a.ticket_id = v_ticket.id;

  INSERT INTO public.support_access_events (grant_id, actor_id, action, ticket_id)
  VALUES (p_grant_id, auth.uid(), 'view_ticket', p_ticket_id);

  RETURN jsonb_build_object('ticket', to_jsonb(v_ticket), 'threads', v_threads, 'attachments', v_attachments);
END;
$$;

REVOKE ALL ON FUNCTION public.support_access_get_ticket(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_get_ticket(uuid, uuid) TO authenticated;

-- support_access_attachment_path: the storage path only; the host signs it
-- with the admin client (the only admin-client use, per the design doc).
CREATE OR REPLACE FUNCTION public.support_access_attachment_path(p_grant_id uuid, p_attachment_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grant public.support_access_grants%ROWTYPE;
  v_attachment public.support_ticket_attachments%ROWTYPE;
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'support: authentication required';
  END IF;
  IF NOT COALESCE(public.support_access_grant_active(p_grant_id), false) THEN
    RAISE EXCEPTION 'support: grant % is not active', p_grant_id;
  END IF;

  SELECT * INTO v_grant FROM public.support_access_grants WHERE id = p_grant_id;

  SELECT * INTO v_attachment FROM public.support_ticket_attachments WHERE id = p_attachment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: attachment % not found', p_attachment_id;
  END IF;

  IF v_grant.ticket_id IS NOT NULL AND v_grant.ticket_id <> v_attachment.ticket_id THEN
    RAISE EXCEPTION 'support: attachment % is outside this grant''s scope', p_attachment_id;
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets t
  WHERE t.id = v_attachment.ticket_id
    AND t.owner_scope = v_grant.owner_scope
    AND t.tenant_id IS NOT DISTINCT FROM v_grant.tenant_id
    AND t.partner_id IS NOT DISTINCT FROM v_grant.partner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support: attachment % is not in this grant''s owner', p_attachment_id;
  END IF;

  INSERT INTO public.support_access_events (grant_id, actor_id, action, ticket_id, attachment_id)
  VALUES (p_grant_id, auth.uid(), 'download_attachment', v_attachment.ticket_id, p_attachment_id);

  RETURN v_attachment.file_path;
END;
$$;

REVOKE ALL ON FUNCTION public.support_access_attachment_path(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_access_attachment_path(uuid, uuid) TO authenticated;
