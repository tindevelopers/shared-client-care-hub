-- 20260924100000_support_owner_escalation.sql
--
-- Support Escalation Chain: every support row (tickets, categories, threads,
-- attachments, history, and the new support_groups) is owned by exactly one
-- of tenant | partner | platform, mirroring agent_instances
-- (20260916150000_agent_owner_scope.sql). Adds support_ticket_links for
-- cross-organization escalation/merge, fixes the history actor and coverage,
-- and rewrites every support RLS policy around ownership instead of a
-- blanket platform bypass.
--
-- Design ref: docs/superpowers/specs/2026-09-24-support-escalation-chain-design.md
--
-- Retired in this change (no production data of substance, confirmed
-- 2026-09-24): escalated_to_platform_admin_at (+ its index), the parallel
-- partner queue (partner_support_tickets, partner_support_ticket_replies,
-- support_inbox_state) and its bump_ticket_updated_at() trigger function.

-- ============================================================================
-- 0. Drop retired objects
-- ============================================================================
DROP TABLE IF EXISTS partner_support_ticket_replies CASCADE;
DROP TABLE IF EXISTS partner_support_tickets CASCADE;
DROP TABLE IF EXISTS support_inbox_state CASCADE;
DROP FUNCTION IF EXISTS public.bump_ticket_updated_at() CASCADE;

DROP INDEX IF EXISTS idx_support_tickets_escalated;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS escalated_to_platform_admin_at;

-- ============================================================================
-- 1. Owner columns on the five existing support tables
--    (support_groups is new and gets the owner columns at creation, below)
-- ============================================================================

-- support_tickets
ALTER TABLE support_tickets ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE CASCADE;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS owner_scope text NOT NULL DEFAULT 'tenant';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_owner_scope_check') THEN
    ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_owner_scope_check
      CHECK (owner_scope IN ('tenant', 'partner', 'platform'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_exactly_one_owner') THEN
    ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_exactly_one_owner CHECK (
      (owner_scope = 'tenant'   AND tenant_id IS NOT NULL AND partner_id IS NULL) OR
      (owner_scope = 'partner'  AND partner_id IS NOT NULL AND tenant_id IS NULL) OR
      (owner_scope = 'platform' AND tenant_id IS NULL AND partner_id IS NULL)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_support_tickets_partner_id ON support_tickets(partner_id);

-- support_categories
ALTER TABLE support_categories ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE support_categories ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE CASCADE;
ALTER TABLE support_categories ADD COLUMN IF NOT EXISTS owner_scope text NOT NULL DEFAULT 'tenant';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_categories_owner_scope_check') THEN
    ALTER TABLE support_categories ADD CONSTRAINT support_categories_owner_scope_check
      CHECK (owner_scope IN ('tenant', 'partner', 'platform'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_categories_exactly_one_owner') THEN
    ALTER TABLE support_categories ADD CONSTRAINT support_categories_exactly_one_owner CHECK (
      (owner_scope = 'tenant'   AND tenant_id IS NOT NULL AND partner_id IS NULL) OR
      (owner_scope = 'partner'  AND partner_id IS NOT NULL AND tenant_id IS NULL) OR
      (owner_scope = 'platform' AND tenant_id IS NULL AND partner_id IS NULL)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_support_categories_partner_id ON support_categories(partner_id);

-- support_ticket_threads
ALTER TABLE support_ticket_threads ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE support_ticket_threads ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE CASCADE;
ALTER TABLE support_ticket_threads ADD COLUMN IF NOT EXISTS owner_scope text NOT NULL DEFAULT 'tenant';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_threads_owner_scope_check') THEN
    ALTER TABLE support_ticket_threads ADD CONSTRAINT support_ticket_threads_owner_scope_check
      CHECK (owner_scope IN ('tenant', 'partner', 'platform'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_threads_exactly_one_owner') THEN
    ALTER TABLE support_ticket_threads ADD CONSTRAINT support_ticket_threads_exactly_one_owner CHECK (
      (owner_scope = 'tenant'   AND tenant_id IS NOT NULL AND partner_id IS NULL) OR
      (owner_scope = 'partner'  AND partner_id IS NOT NULL AND tenant_id IS NULL) OR
      (owner_scope = 'platform' AND tenant_id IS NULL AND partner_id IS NULL)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_support_ticket_threads_partner_id ON support_ticket_threads(partner_id);

-- support_ticket_attachments
ALTER TABLE support_ticket_attachments ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE support_ticket_attachments ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE CASCADE;
ALTER TABLE support_ticket_attachments ADD COLUMN IF NOT EXISTS owner_scope text NOT NULL DEFAULT 'tenant';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_attachments_owner_scope_check') THEN
    ALTER TABLE support_ticket_attachments ADD CONSTRAINT support_ticket_attachments_owner_scope_check
      CHECK (owner_scope IN ('tenant', 'partner', 'platform'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_attachments_exactly_one_owner') THEN
    ALTER TABLE support_ticket_attachments ADD CONSTRAINT support_ticket_attachments_exactly_one_owner CHECK (
      (owner_scope = 'tenant'   AND tenant_id IS NOT NULL AND partner_id IS NULL) OR
      (owner_scope = 'partner'  AND partner_id IS NOT NULL AND tenant_id IS NULL) OR
      (owner_scope = 'platform' AND tenant_id IS NULL AND partner_id IS NULL)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_partner_id ON support_ticket_attachments(partner_id);

-- support_ticket_history
ALTER TABLE support_ticket_history ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE support_ticket_history ALTER COLUMN changed_by DROP NOT NULL;
ALTER TABLE support_ticket_history ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE CASCADE;
ALTER TABLE support_ticket_history ADD COLUMN IF NOT EXISTS owner_scope text NOT NULL DEFAULT 'tenant';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_history_owner_scope_check') THEN
    ALTER TABLE support_ticket_history ADD CONSTRAINT support_ticket_history_owner_scope_check
      CHECK (owner_scope IN ('tenant', 'partner', 'platform'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_ticket_history_exactly_one_owner') THEN
    ALTER TABLE support_ticket_history ADD CONSTRAINT support_ticket_history_exactly_one_owner CHECK (
      (owner_scope = 'tenant'   AND tenant_id IS NOT NULL AND partner_id IS NULL) OR
      (owner_scope = 'partner'  AND partner_id IS NOT NULL AND tenant_id IS NULL) OR
      (owner_scope = 'platform' AND tenant_id IS NULL AND partner_id IS NULL)
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_support_ticket_history_partner_id ON support_ticket_history(partner_id);

-- ============================================================================
-- 2. Support groups (tiers inside one owner)
-- ============================================================================
CREATE TABLE IF NOT EXISTS support_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_scope text NOT NULL DEFAULT 'tenant' CHECK (owner_scope IN ('tenant', 'partner', 'platform')),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,
  name text NOT NULL,
  rank int NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_groups_exactly_one_owner CHECK (
    (owner_scope = 'tenant'   AND tenant_id IS NOT NULL AND partner_id IS NULL) OR
    (owner_scope = 'partner'  AND partner_id IS NOT NULL AND tenant_id IS NULL) OR
    (owner_scope = 'platform' AND tenant_id IS NULL AND partner_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS support_groups_owner_rank_unique
  ON support_groups (owner_scope, tenant_id, partner_id, rank) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_support_groups_tenant_id ON support_groups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_groups_partner_id ON support_groups(partner_id);

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES support_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_group_id ON support_tickets(group_id);

-- ============================================================================
-- 3. Owner immutability: BEFORE UPDATE on every owned table
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_tickets_owner_immutable ON support_tickets;
CREATE TRIGGER support_tickets_owner_immutable
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.support_owner_is_immutable();

DROP TRIGGER IF EXISTS support_categories_owner_immutable ON support_categories;
CREATE TRIGGER support_categories_owner_immutable
  BEFORE UPDATE ON support_categories
  FOR EACH ROW EXECUTE FUNCTION public.support_owner_is_immutable();

DROP TRIGGER IF EXISTS support_groups_owner_immutable ON support_groups;
CREATE TRIGGER support_groups_owner_immutable
  BEFORE UPDATE ON support_groups
  FOR EACH ROW EXECUTE FUNCTION public.support_owner_is_immutable();

DROP TRIGGER IF EXISTS support_ticket_threads_owner_immutable ON support_ticket_threads;
CREATE TRIGGER support_ticket_threads_owner_immutable
  BEFORE UPDATE ON support_ticket_threads
  FOR EACH ROW EXECUTE FUNCTION public.support_owner_is_immutable();

DROP TRIGGER IF EXISTS support_ticket_attachments_owner_immutable ON support_ticket_attachments;
CREATE TRIGGER support_ticket_attachments_owner_immutable
  BEFORE UPDATE ON support_ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION public.support_owner_is_immutable();

DROP TRIGGER IF EXISTS support_ticket_history_owner_immutable ON support_ticket_history;
CREATE TRIGGER support_ticket_history_owner_immutable
  BEFORE UPDATE ON support_ticket_history
  FOR EACH ROW EXECUTE FUNCTION public.support_owner_is_immutable();

-- ============================================================================
-- 4. Child rows inherit the ticket's owner: BEFORE INSERT, ignore client input
-- ============================================================================
CREATE OR REPLACE FUNCTION public.support_child_inherits_ticket_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_scope text;
  v_tenant_id uuid;
  v_partner_id uuid;
BEGIN
  SELECT owner_scope, tenant_id, partner_id
  INTO v_owner_scope, v_tenant_id, v_partner_id
  FROM public.support_tickets
  WHERE id = NEW.ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'support_tickets row % not found for owner inheritance', NEW.ticket_id;
  END IF;

  NEW.owner_scope := v_owner_scope;
  NEW.tenant_id := v_tenant_id;
  NEW.partner_id := v_partner_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_threads_inherit_owner ON support_ticket_threads;
CREATE TRIGGER support_ticket_threads_inherit_owner
  BEFORE INSERT ON support_ticket_threads
  FOR EACH ROW EXECUTE FUNCTION public.support_child_inherits_ticket_owner();

DROP TRIGGER IF EXISTS support_ticket_attachments_inherit_owner ON support_ticket_attachments;
CREATE TRIGGER support_ticket_attachments_inherit_owner
  BEFORE INSERT ON support_ticket_attachments
  FOR EACH ROW EXECUTE FUNCTION public.support_child_inherits_ticket_owner();

DROP TRIGGER IF EXISTS support_ticket_history_inherit_owner ON support_ticket_history;
CREATE TRIGGER support_ticket_history_inherit_owner
  BEFORE INSERT ON support_ticket_history
  FOR EACH ROW EXECUTE FUNCTION public.support_child_inherits_ticket_owner();

-- ============================================================================
-- 5. Statuses
-- ============================================================================
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_status_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_status_check
  CHECK (status IN ('open', 'in_progress', 'waiting_on_customer', 'waiting_on_upstream', 'resolved', 'closed'));

-- ============================================================================
-- 6. Ticket numbers and category names, per owner
-- ============================================================================
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_tenant_ticket_number_unique;
CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_owner_ticket_number_unique
  ON support_tickets (owner_scope, tenant_id, partner_id, ticket_number) NULLS NOT DISTINCT;

ALTER TABLE support_categories DROP CONSTRAINT IF EXISTS support_categories_tenant_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS support_categories_owner_name_unique
  ON support_categories (owner_scope, tenant_id, partner_id, name) NULLS NOT DISTINCT;

-- generate_ticket_number(tenant_id) is superseded by the owner-aware version;
-- grepped the migrations — nothing else calls it.
DROP FUNCTION IF EXISTS public.generate_ticket_number(uuid);

-- SECURITY DEFINER: the next number must be computed over ALL of the owner's
-- tickets, not only the rows the inserting user can see under RLS.
CREATE OR REPLACE FUNCTION public.generate_ticket_number(p_owner_scope text, p_tenant_id uuid, p_partner_id uuid)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  year_part TEXT;
  sequence_num INTEGER;
  ticket_num TEXT;
BEGIN
  year_part := TO_CHAR(NOW(), 'YYYY');

  SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
  INTO sequence_num
  FROM support_tickets
  WHERE owner_scope = p_owner_scope
    AND tenant_id IS NOT DISTINCT FROM p_tenant_id
    AND partner_id IS NOT DISTINCT FROM p_partner_id
    AND ticket_number LIKE 'TKT-' || year_part || '-%';

  ticket_num := 'TKT-' || year_part || '-' || LPAD(sequence_num::TEXT, 5, '0');

  RETURN ticket_num;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := public.generate_ticket_number(NEW.owner_scope, NEW.tenant_id, NEW.partner_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. Ticket links (cross-organization escalation / merge)
-- ============================================================================
CREATE TABLE IF NOT EXISTS support_ticket_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('escalation', 'merge')),
  from_ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  to_ticket_id uuid REFERENCES support_tickets(id) ON DELETE CASCADE,
  provider text,
  external_id text,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'resolved', 'returned', 'withdrawn')),
  shared jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT support_ticket_links_target_check
    CHECK ((to_ticket_id IS NOT NULL) <> (provider IS NOT NULL AND external_id IS NOT NULL)),
  CONSTRAINT support_ticket_links_kind_target_check
    CHECK (kind = 'escalation' OR to_ticket_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS support_ticket_links_one_active_escalation
  ON support_ticket_links (from_ticket_id) WHERE kind = 'escalation' AND state = 'active';
CREATE INDEX IF NOT EXISTS idx_support_ticket_links_from_ticket ON support_ticket_links(from_ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_links_to_ticket ON support_ticket_links(to_ticket_id) WHERE to_ticket_id IS NOT NULL;

ALTER TABLE support_ticket_links ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 8. History: actor fix + coverage (status, priority, assigned_to, group_id)
--    and the initial status row on INSERT.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.track_ticket_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
BEGIN
  -- The signed-in user always wins; the setting is only for server-side
  -- functions running without a user (auth.uid() IS NULL). NULL = system.
  v_actor := COALESCE(auth.uid(), NULLIF(current_setting('app.support_actor_id', true), '')::uuid);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO support_ticket_history (ticket_id, owner_scope, tenant_id, partner_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, NEW.owner_scope, NEW.tenant_id, NEW.partner_id, v_actor, 'status', NULL, NEW.status);
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO support_ticket_history (ticket_id, owner_scope, tenant_id, partner_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, NEW.owner_scope, NEW.tenant_id, NEW.partner_id, v_actor, 'status', OLD.status, NEW.status);
  END IF;

  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    INSERT INTO support_ticket_history (ticket_id, owner_scope, tenant_id, partner_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, NEW.owner_scope, NEW.tenant_id, NEW.partner_id, v_actor, 'priority', OLD.priority, NEW.priority);
  END IF;

  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    INSERT INTO support_ticket_history (ticket_id, owner_scope, tenant_id, partner_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, NEW.owner_scope, NEW.tenant_id, NEW.partner_id, v_actor, 'assigned_to',
            COALESCE(OLD.assigned_to::TEXT, ''), COALESCE(NEW.assigned_to::TEXT, ''));
  END IF;

  IF OLD.group_id IS DISTINCT FROM NEW.group_id THEN
    INSERT INTO support_ticket_history (ticket_id, owner_scope, tenant_id, partner_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, NEW.owner_scope, NEW.tenant_id, NEW.partner_id, v_actor, 'group_id',
            COALESCE(OLD.group_id::TEXT, ''), COALESCE(NEW.group_id::TEXT, ''));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS track_support_ticket_changes ON support_tickets;
CREATE TRIGGER track_support_ticket_changes
  AFTER UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.track_ticket_history();

DROP TRIGGER IF EXISTS track_support_ticket_created ON support_tickets;
CREATE TRIGGER track_support_ticket_created
  AFTER INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.track_ticket_history();

-- ============================================================================
-- 9. RLS helpers
-- ============================================================================
-- The user's OWN tenant. Deliberately not public.get_current_tenant_id(): that
-- helper returns the x-tenant-id request header for Platform Admins, which
-- would give platform staff unaudited access to every tenant's tickets.
-- Platform access to another owner's tickets comes later, through audited
-- support sessions.
CREATE OR REPLACE FUNCTION public.support_member_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.support_member_tenant_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_support_platform_operator()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid()
      AND r.name IN ('Platform Admin', 'System Admin')
      AND u.tenant_id IS NULL
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_support_platform_operator() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_support_owner(p_scope text, p_tenant uuid, p_partner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  -- COALESCE: a caller with no tenant or partner of their own makes the
  -- comparisons NULL; always answer false, never NULL.
  SELECT COALESCE(CASE p_scope
    WHEN 'tenant' THEN p_tenant = public.support_member_tenant_id()
    WHEN 'partner' THEN public.current_user_is_partner_admin() AND p_partner = public.get_current_user_partner_id()
    WHEN 'platform' THEN public.is_support_platform_operator()
    ELSE false
  END, false);
$$;
GRANT EXECUTE ON FUNCTION public.can_access_support_owner(text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_support_ticket(p_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_tickets t
    WHERE t.id = p_ticket_id
      AND public.can_access_support_owner(t.owner_scope, t.tenant_id, t.partner_id)
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) TO authenticated;

-- A requester who is not a member of the ticket's owner (for example the
-- downstream agent who escalated, on the upstream ticket) may only reopen a
-- resolved ticket or close it; every other column stays as the owner set it.
-- Only the ticket's own requester is restricted: other non-members cannot
-- pass RLS at all, and the escalation gateway (SECURITY DEFINER, acting as
-- an upstream member on a downstream ticket) must stay able to hand back.
CREATE OR REPLACE FUNCTION public.support_ticket_requester_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR OLD.created_by IS DISTINCT FROM auth.uid()
     OR public.can_access_support_owner(OLD.owner_scope, OLD.tenant_id, OLD.partner_id) THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'a requester can only reopen or close their support ticket';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'resolved' AND NEW.status = 'in_progress')
     AND NOT (NEW.status = 'closed' AND OLD.status IN ('open', 'in_progress', 'waiting_on_customer', 'resolved')) THEN
    RAISE EXCEPTION 'a requester can only reopen or close their support ticket';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_tickets_requester_guard ON support_tickets;
CREATE TRIGGER support_tickets_requester_guard
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.support_ticket_requester_guard();

-- ============================================================================
-- 10. RLS policies — replace ALL existing policies on the support tables
-- ============================================================================

-- support_categories: full CRUD for owner members only.
DROP POLICY IF EXISTS "Platform admins can view all support categories" ON support_categories;
DROP POLICY IF EXISTS "Users can view support categories in their tenant" ON support_categories;
DROP POLICY IF EXISTS "Users can insert support categories in their tenant" ON support_categories;
DROP POLICY IF EXISTS "Users can update support categories in their tenant" ON support_categories;
DROP POLICY IF EXISTS "Users can delete support categories in their tenant" ON support_categories;
DROP POLICY IF EXISTS "Platform admins can manage all support categories" ON support_categories;

CREATE POLICY "Owner members can manage support categories"
  ON support_categories FOR ALL
  USING (public.can_access_support_owner(owner_scope, tenant_id, partner_id))
  WITH CHECK (public.can_access_support_owner(owner_scope, tenant_id, partner_id));

-- support_groups: full CRUD for owner members only.
DROP POLICY IF EXISTS "Owner members can manage support groups" ON support_groups;
CREATE POLICY "Owner members can manage support groups"
  ON support_groups FOR ALL
  USING (public.can_access_support_owner(owner_scope, tenant_id, partner_id))
  WITH CHECK (public.can_access_support_owner(owner_scope, tenant_id, partner_id));

-- support_tickets: owner members (SELECT/INSERT/UPDATE, no DELETE) + requesters.
DROP POLICY IF EXISTS "Platform admins can view all support tickets" ON support_tickets;
DROP POLICY IF EXISTS "Customers can view their own support tickets" ON support_tickets;
DROP POLICY IF EXISTS "Agents can view support tickets in their tenant" ON support_tickets;
DROP POLICY IF EXISTS "Customers can create support tickets" ON support_tickets;
DROP POLICY IF EXISTS "Agents can create support tickets in their tenant" ON support_tickets;
DROP POLICY IF EXISTS "Customers can update their own support tickets" ON support_tickets;
DROP POLICY IF EXISTS "Agents can update support tickets in their tenant" ON support_tickets;
DROP POLICY IF EXISTS "Platform admins can manage all support tickets" ON support_tickets;

CREATE POLICY "Owner members can view support tickets"
  ON support_tickets FOR SELECT
  USING (public.can_access_support_owner(owner_scope, tenant_id, partner_id));

CREATE POLICY "Owner members can create support tickets"
  ON support_tickets FOR INSERT
  WITH CHECK (public.can_access_support_owner(owner_scope, tenant_id, partner_id));

CREATE POLICY "Owner members can update support tickets"
  ON support_tickets FOR UPDATE
  USING (public.can_access_support_owner(owner_scope, tenant_id, partner_id));

CREATE POLICY "Requesters can view their support tickets"
  ON support_tickets FOR SELECT
  USING (created_by = auth.uid());

CREATE POLICY "Requesters can create their own tenant support tickets"
  ON support_tickets FOR INSERT
  WITH CHECK (
    owner_scope = 'tenant'
    AND tenant_id = public.support_member_tenant_id()
    AND created_by = auth.uid()
  );

CREATE POLICY "Requesters can update their support tickets"
  ON support_tickets FOR UPDATE
  USING (created_by = auth.uid());

-- support_ticket_threads: owner members + requesters (public replies only).
DROP POLICY IF EXISTS "Platform admins can view all support ticket threads" ON support_ticket_threads;
DROP POLICY IF EXISTS "Users can view support ticket threads for accessible tickets" ON support_ticket_threads;
DROP POLICY IF EXISTS "Users can create support ticket threads" ON support_ticket_threads;
DROP POLICY IF EXISTS "Users can update their own support ticket threads" ON support_ticket_threads;
DROP POLICY IF EXISTS "Platform admins can manage all support ticket threads" ON support_ticket_threads;

CREATE POLICY "Owner members can view support ticket threads"
  ON support_ticket_threads FOR SELECT
  USING (public.can_access_support_owner(owner_scope, tenant_id, partner_id));

CREATE POLICY "Owner members can create support ticket threads"
  ON support_ticket_threads FOR INSERT
  WITH CHECK (
    public.can_access_support_owner(owner_scope, tenant_id, partner_id)
    AND user_id = auth.uid()
  );

CREATE POLICY "Owner members can update their own support ticket threads"
  ON support_ticket_threads FOR UPDATE
  USING (
    public.can_access_support_owner(owner_scope, tenant_id, partner_id)
    AND user_id = auth.uid()
  );

CREATE POLICY "Requesters can view public replies on their tickets"
  ON support_ticket_threads FOR SELECT
  USING (
    is_internal = false
    AND ticket_id IN (SELECT id FROM support_tickets WHERE created_by = auth.uid())
  );

CREATE POLICY "Requesters can reply on their tickets"
  ON support_ticket_threads FOR INSERT
  WITH CHECK (
    is_internal = false
    AND user_id = auth.uid()
    AND ticket_id IN (SELECT id FROM support_tickets WHERE created_by = auth.uid())
  );

-- support_ticket_attachments: owner members + requesters (SELECT, non-internal only).
DROP POLICY IF EXISTS "Platform admins can view all support ticket attachments" ON support_ticket_attachments;
DROP POLICY IF EXISTS "Users can view support ticket attachments for accessible tickets" ON support_ticket_attachments;
DROP POLICY IF EXISTS "Users can create support ticket attachments" ON support_ticket_attachments;
DROP POLICY IF EXISTS "Users can delete their own support ticket attachments" ON support_ticket_attachments;
DROP POLICY IF EXISTS "Platform admins can manage all support ticket attachments" ON support_ticket_attachments;

CREATE POLICY "Owner members can view support ticket attachments"
  ON support_ticket_attachments FOR SELECT
  USING (public.can_access_support_owner(owner_scope, tenant_id, partner_id));

CREATE POLICY "Owner members can create support ticket attachments"
  ON support_ticket_attachments FOR INSERT
  WITH CHECK (
    public.can_access_support_owner(owner_scope, tenant_id, partner_id)
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "Owner members can delete their own support ticket attachments"
  ON support_ticket_attachments FOR DELETE
  USING (
    public.can_access_support_owner(owner_scope, tenant_id, partner_id)
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "Requesters can view attachments on their tickets"
  ON support_ticket_attachments FOR SELECT
  USING (
    ticket_id IN (SELECT id FROM support_tickets WHERE created_by = auth.uid())
    AND (
      thread_id IS NULL
      OR thread_id IN (SELECT id FROM support_ticket_threads WHERE is_internal = false)
    )
  );

-- support_ticket_history: owner members + requesters (SELECT only).
-- No INSERT policy: history is written only by the SECURITY DEFINER
-- track_ticket_history() trigger, so no client can forge audit or clock rows.
DROP POLICY IF EXISTS "Platform admins can view all support ticket history" ON support_ticket_history;
DROP POLICY IF EXISTS "Users can view support ticket history for accessible tickets" ON support_ticket_history;
DROP POLICY IF EXISTS "System can insert support ticket history" ON support_ticket_history;

CREATE POLICY "Owner members can view support ticket history"
  ON support_ticket_history FOR SELECT
  USING (public.can_access_support_owner(owner_scope, tenant_id, partner_id));

CREATE POLICY "Requesters can view history of their tickets"
  ON support_ticket_history FOR SELECT
  USING (ticket_id IN (SELECT id FROM support_tickets WHERE created_by = auth.uid()));

-- support_ticket_links: SELECT only, to an owner member at either end.
-- No INSERT/UPDATE/DELETE policy — only the service role writes links.
DROP POLICY IF EXISTS "Owner members can view ticket links" ON support_ticket_links;
CREATE POLICY "Owner members can view ticket links"
  ON support_ticket_links FOR SELECT
  USING (
    public.can_access_support_ticket(from_ticket_id)
    OR (to_ticket_id IS NOT NULL AND public.can_access_support_ticket(to_ticket_id))
  );

-- ============================================================================
-- 11. Storage: support-tickets bucket, owner-scoped folders
--     tenant: <tenant_id>/…   partner: partner/<partner_id>/…   platform: platform/…
-- ============================================================================
CREATE OR REPLACE FUNCTION public.can_access_support_storage_folder(p_folder text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    p_folder[1] = public.support_member_tenant_id()::text
    OR (
      p_folder[1] = 'partner'
      AND public.current_user_is_partner_admin()
      AND p_folder[2] = public.get_current_user_partner_id()::text
    )
    OR (
      p_folder[1] = 'platform'
      AND public.is_support_platform_operator()
    );
$$;
GRANT EXECUTE ON FUNCTION public.can_access_support_storage_folder(text[]) TO authenticated;

DROP POLICY IF EXISTS "Users can upload support ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can view support ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete support ticket attachments" ON storage.objects;

CREATE POLICY "Support owners can upload ticket attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'support-tickets'
    AND auth.uid() IS NOT NULL
    AND public.can_access_support_storage_folder(storage.foldername(name))
  );

CREATE POLICY "Support owners can view ticket attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'support-tickets'
    AND auth.uid() IS NOT NULL
    AND public.can_access_support_storage_folder(storage.foldername(name))
  );

CREATE POLICY "Support owners can delete their ticket attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'support-tickets'
    AND auth.uid() IS NOT NULL
    AND owner = auth.uid()
    AND public.can_access_support_storage_folder(storage.foldername(name))
  );
