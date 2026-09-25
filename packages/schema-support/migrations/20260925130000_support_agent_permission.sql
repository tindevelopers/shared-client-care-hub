-- Support agents are a permission, not "any member of the tenant".
--
-- Design: shell-base-admin docs/specs/2026-09-25-support-agent-permission-design.md
-- (approved 2026-09-25). Before this migration any member of a ticket's
-- owning tenant passed can_access_support_owner('tenant', ...), so every
-- member could read internal notes, change ticket state and administer
-- categories and groups. Now the tenant branch also requires the
-- support.agent permission from the hub's permission catalog
-- (20260925120000_role_permission_grants.sql, schema-identity 1.1.0).
-- No policy here names a role.
--
-- Plain members keep the Requester policies: create their own tickets, see
-- them with public replies and attachments, reply publicly, attach files.
-- Partner and platform branches are unchanged.

-- 1. The tenant branch requires support.agent.
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
                   AND public.current_user_has_permission('support.agent')
    WHEN 'partner' THEN public.current_user_is_partner_admin() AND p_partner = public.get_current_user_partner_id()
    WHEN 'platform' THEN public.is_support_platform_operator()
    ELSE false
  END, false);
$$;

-- 2. Approving support access grants: the tenant side asks the same
--    permission instead of naming the admin roles.
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
      AND public.current_user_has_permission('support.agent')
    WHEN 'partner' THEN
      public.current_user_is_partner_admin() AND p_partner = public.get_current_user_partner_id()
    ELSE false
  END, false);
$$;

-- 3. support_groups was created (20260924100000) with policies but without
--    row level security, so the policies never applied: every signed-in user
--    of every tenant could read and write every group. Turn it on.
ALTER TABLE support_groups ENABLE ROW LEVEL SECURITY;

--    Members read their tenant's categories and groups (the new-ticket form
--    needs them); writes stay with agents via the owner-member policies.
DROP POLICY IF EXISTS "Tenant members can view support categories" ON support_categories;
CREATE POLICY "Tenant members can view support categories"
  ON support_categories FOR SELECT
  USING (owner_scope = 'tenant' AND tenant_id = public.support_member_tenant_id());

DROP POLICY IF EXISTS "Tenant members can view support groups" ON support_groups;
CREATE POLICY "Tenant members can view support groups"
  ON support_groups FOR SELECT
  USING (owner_scope = 'tenant' AND tenant_id = public.support_member_tenant_id());

-- 4. Requesters attach files to their own tickets (ticket-level or on a
--    public reply). Before, they could only because every member was an
--    owner member.
DROP POLICY IF EXISTS "Requesters can attach files to their tickets" ON support_ticket_attachments;
CREATE POLICY "Requesters can attach files to their tickets"
  ON support_ticket_attachments FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND ticket_id IN (SELECT id FROM support_tickets WHERE created_by = auth.uid())
    AND (
      thread_id IS NULL
      OR thread_id IN (SELECT id FROM support_ticket_threads WHERE is_internal = false)
    )
  );

-- 5. Storage. Tenant files live at <tenant_id>/<ticket_id>/<file>. An agent
--    reaches the whole tenant folder; a plain member only the folders of
--    tickets they created, and never a file attached to an internal note.
CREATE OR REPLACE FUNCTION public.can_access_support_storage_folder(p_folder text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      p_folder[1] = public.support_member_tenant_id()::text
      AND (
        public.current_user_has_permission('support.agent')
        OR EXISTS (
          SELECT 1 FROM public.support_tickets t
          WHERE t.id::text = p_folder[2]
            AND t.created_by = auth.uid()
        )
      )
    )
    OR (
      p_folder[1] = 'partner'
      AND public.current_user_is_partner_admin()
      AND p_folder[2] = public.get_current_user_partner_id()::text
    )
    OR (
      p_folder[1] = 'platform'
      AND public.is_support_platform_operator()
    ),
  false);
$$;

-- True when the object is attached to an internal note.
CREATE OR REPLACE FUNCTION public.support_storage_object_is_internal(p_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.support_ticket_attachments a
    JOIN public.support_ticket_threads th ON th.id = a.thread_id
    WHERE a.file_path = p_name AND th.is_internal
  );
$$;
GRANT EXECUTE ON FUNCTION public.support_storage_object_is_internal(text) TO authenticated;

DROP POLICY IF EXISTS "Support owners can view ticket attachments" ON storage.objects;
CREATE POLICY "Support owners can view ticket attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'support-tickets'
    AND auth.uid() IS NOT NULL
    AND public.can_access_support_storage_folder(storage.foldername(name))
    AND (
      (storage.foldername(name))[1] IN ('partner', 'platform')
      OR public.current_user_has_permission('support.agent')
      OR NOT public.support_storage_object_is_internal(name)
    )
  );
