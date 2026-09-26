-- 20260925090000_pin_support_ticket_created_by.sql
--
-- Tenant-isolation gap in support_tickets: "Owner members can create support
-- tickets" (20260924100000_support_owner_escalation.sql) checks only
-- can_access_support_owner(owner_scope, tenant_id, partner_id) on INSERT —
-- it never constrains created_by. Any owner member could INSERT (or, since
-- "Owner members can update support tickets" has no explicit WITH CHECK and
-- Postgres defaults an unset WITH CHECK to the policy's own USING clause,
-- UPDATE) a ticket in their own tenant/partner/platform queue with
-- created_by set to an arbitrary user id — including a user in a different
-- tenant. That user then qualifies for "Requesters can view their support
-- tickets" / "...reply on their tickets" (created_by = auth.uid()), reading
-- and replying on a ticket in an owner they were never a member of. A
-- within-tenant actor can hand tenant data to an outside account at will.
--
-- Fix: created_by becomes immutable after insert (folded into the existing
-- support_owner_is_immutable trigger — no legitimate reason to reassign who
-- raised a ticket), and the "Owner members can create" WITH CHECK is
-- tightened so created_by must be either the caller (the common case) or
-- another member of the same owner (staff filing a ticket on a teammate's or
-- an existing customer's behalf stays possible; naming an outsider does
-- not). "Requesters can create their own tenant support tickets" already
-- pins created_by = auth.uid() and is untouched.

-- ============================================================================
-- 1. created_by is immutable, same trigger as the owner columns.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.support_owner_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.owner_scope IS DISTINCT FROM OLD.owner_scope
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id THEN
    RAISE EXCEPTION 'support owner columns (owner_scope, tenant_id, partner_id) are immutable';
  END IF;
  IF TG_TABLE_NAME = 'support_tickets' AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'support_tickets.created_by is immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Helper: does target user p_user_id belong to this owner? Mirrors
--    can_access_support_owner (20260924100000) but for an arbitrary user,
--    not the caller — needed to validate created_by on INSERT.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.support_user_belongs_to_owner(p_user_id uuid, p_scope text, p_tenant uuid, p_partner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(CASE p_scope
    WHEN 'tenant' THEN EXISTS (
      SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.tenant_id = p_tenant
    )
    WHEN 'partner' THEN EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON r.id = u.role_id
      WHERE u.id = p_user_id AND r.name = 'Partner Admin' AND u.partner_id = p_partner
    )
    WHEN 'platform' THEN EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON r.id = u.role_id
      WHERE u.id = p_user_id AND r.name IN ('Platform Admin', 'System Admin') AND u.tenant_id IS NULL
    )
    ELSE false
  END, false);
$$;
REVOKE ALL ON FUNCTION public.support_user_belongs_to_owner(uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_user_belongs_to_owner(uuid, text, uuid, uuid) TO authenticated;

-- ============================================================================
-- 3. Pin created_by on the owner-member INSERT policy.
-- ============================================================================
DROP POLICY IF EXISTS "Owner members can create support tickets" ON support_tickets;
CREATE POLICY "Owner members can create support tickets"
  ON support_tickets FOR INSERT
  WITH CHECK (
    public.can_access_support_owner(owner_scope, tenant_id, partner_id)
    AND (
      created_by = auth.uid()
      OR public.support_user_belongs_to_owner(created_by, owner_scope, tenant_id, partner_id)
    )
  );

-- ============================================================================
-- 4. Diagnostic only: surface any existing rows the immutability trigger
--    would now freeze in a state where created_by isn't a member of the
--    ticket's own owner (pre-existing data from before this fix). Not
--    corrected here — reassigning it is a product decision, not this
--    migration's call.
-- ============================================================================
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.support_tickets t
  WHERE NOT public.support_user_belongs_to_owner(t.created_by, t.owner_scope, t.tenant_id, t.partner_id);

  IF v_count > 0 THEN
    RAISE NOTICE 'support_tickets: % row(s) have created_by outside their own ticket owner (pre-existing, not modified by this migration)', v_count;
  END IF;
END;
$$;
