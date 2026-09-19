-- Atomic, tenant-aware campaign audience replacement.
--
-- Additive follow-up to 20260919010000_contact_lists_suppressions.sql: the
-- domain store previously issued separate ownership-read, delete, and insert
-- requests, so a failed insert left the prior audience irreversibly cleared and
-- two concurrent replacements could interleave into the UNION of both requested
-- audiences. This migration moves the whole replacement into one transaction.
--
-- Rerunnable: the function uses CREATE OR REPLACE and the REVOKE/GRANT pair is
-- idempotent. No table, column, index, trigger, or policy is touched.
--
-- Security invariants enforced here:
--   * SECURITY INVOKER — the caller's own RLS still governs every row the
--     function reads, locks, deletes, and inserts (no definer privilege
--     escalation, no service-role bypass baked into the function);
--   * tenant ownership is validated by locking the LIVE campaign row
--     (`id` + bound `tenant_id` + `deleted_at IS NULL`) `FOR UPDATE` before any
--     mutation, which both rejects foreign/soft-deleted campaigns and
--     serializes concurrent replacements of the same campaign;
--   * the delete and the insert are pinned to the bound `(tenant_id,
--     campaign_id)` pair, and caller-supplied `tenant_id` / `campaign_id` /
--     `id` keys in the JSONB payload are structurally ignored — they are not
--     part of the recordset definition, so ownership can only come from the
--     validated parameters;
--   * every relation is schema-qualified and `search_path` is pinned to
--     `public, pg_temp` so a hostile temp object cannot shadow a reference.

CREATE OR REPLACE FUNCTION public.replace_campaign_recipients(
  p_campaign_id UUID,
  p_tenant_id UUID,
  p_recipients JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_locked_id UUID;
  v_replaced INTEGER;
BEGIN
  IF jsonb_typeof(p_recipients) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'replace_campaign_recipients expects a JSONB array of recipient drafts'
      USING ERRCODE = '22023';
  END IF;

  -- Ownership + liveness check, and the serialization point for concurrent
  -- replacements. Under SECURITY INVOKER this read is RLS-filtered, so a
  -- campaign the caller cannot see simply does not exist here.
  SELECT c.id INTO v_locked_id
  FROM public.campaigns AS c
  WHERE c.id = p_campaign_id
    AND c.tenant_id = p_tenant_id
    AND c.deleted_at IS NULL
  FOR UPDATE;

  IF v_locked_id IS NULL THEN
    RAISE EXCEPTION 'campaign % is not a live campaign of tenant %', p_campaign_id, p_tenant_id
      USING ERRCODE = '42501';
  END IF;

  -- Clear the bound audience only. Runs in the same transaction as the insert
  -- below, so a failing insert rolls the delete back and the prior audience
  -- survives.
  DELETE FROM public.campaign_recipients AS r
  WHERE r.tenant_id = p_tenant_id
    AND r.campaign_id = p_campaign_id;

  -- Ownership columns come from the validated parameters; every other column
  -- is a canonical draft field. Omitted (or JSON-null) draft fields fall back
  -- to the column default a direct insert would have produced. `id`,
  -- `created_at`, and `updated_at` stay DB-owned.
  INSERT INTO public.campaign_recipients (
    tenant_id,
    campaign_id,
    list_id,
    contact_id,
    first_name,
    last_name,
    phone,
    email,
    timezone,
    client_type,
    custom_fields,
    status,
    scheduled_at,
    attempts,
    last_attempt_at,
    completed_at,
    call_control_id,
    conversation_id,
    result,
    conversation_status,
    last_turn_at,
    turn_count,
    sms_opt_out,
    retry_attempts,
    last_inbound_at,
    provider_recipient_id,
    provider_message_id,
    engagement
  )
  SELECT
    p_tenant_id,
    p_campaign_id,
    d.list_id,
    d.contact_id,
    d.first_name,
    d.last_name,
    d.phone,
    d.email,
    COALESCE(d.timezone, 'America/New_York'),
    d.client_type,
    COALESCE(d.custom_fields, '{}'::jsonb),
    COALESCE(d.status, 'pending'),
    d.scheduled_at,
    COALESCE(d.attempts, 0),
    d.last_attempt_at,
    d.completed_at,
    d.call_control_id,
    d.conversation_id,
    COALESCE(d.result, '{}'::jsonb),
    COALESCE(d.conversation_status, 'not_started'),
    d.last_turn_at,
    COALESCE(d.turn_count, 0),
    COALESCE(d.sms_opt_out, false),
    COALESCE(d.retry_attempts, 0),
    d.last_inbound_at,
    d.provider_recipient_id,
    d.provider_message_id,
    COALESCE(d.engagement, '{}'::jsonb)
  FROM jsonb_to_recordset(p_recipients) AS d(
    list_id UUID,
    contact_id UUID,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    email TEXT,
    timezone TEXT,
    client_type TEXT,
    custom_fields JSONB,
    status TEXT,
    scheduled_at TIMESTAMPTZ,
    attempts INTEGER,
    last_attempt_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    call_control_id TEXT,
    conversation_id TEXT,
    result JSONB,
    conversation_status TEXT,
    last_turn_at TIMESTAMPTZ,
    turn_count INTEGER,
    sms_opt_out BOOLEAN,
    retry_attempts INTEGER,
    last_inbound_at TIMESTAMPTZ,
    provider_recipient_id TEXT,
    provider_message_id TEXT,
    engagement JSONB
  );

  GET DIAGNOSTICS v_replaced = ROW_COUNT;
  RETURN v_replaced;
END;
$$;

-- Execute is intended for signed-in tenant callers and the server-side
-- composition only. The default PUBLIC grant is removed and `anon` is never
-- granted: an unauthenticated caller has no tenant and must not reach this
-- write path at all.
REVOKE ALL ON FUNCTION public.replace_campaign_recipients(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_campaign_recipients(UUID, UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_campaign_recipients(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_campaign_recipients(UUID, UUID, JSONB) TO service_role;
