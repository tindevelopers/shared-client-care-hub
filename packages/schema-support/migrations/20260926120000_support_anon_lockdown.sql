-- Signed-out (anon) callers get nothing from support: no policy evaluation,
-- no helper functions.
--
-- Found by the Supabase security advisor after the support migrations were
-- applied (2026-09-26): the support SECURITY DEFINER helpers were executable
-- by anon through /rest/v1/rpc (Supabase grants EXECUTE on new functions to
-- every API role by default). They answered false or NULL for anon, so no data
-- leaked, but none of them has a reason to be callable signed-out.
--
-- Order matters: the support policies call these helpers directly and
-- applied to every role ({public}). Revoking anon's EXECUTE while anon still
-- evaluated those policies would turn a signed-out read (for example of a
-- public storage bucket, which shares storage.objects with the support
-- policies) into "permission denied". So the policies are scoped to
-- authenticated first; anon then matches no support policy and gets zero
-- rows by row level security, without calling any helper.

-- 1. Support policies apply to signed-in users only.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'support_categories', 'support_groups', 'support_tickets',
        'support_ticket_threads', 'support_ticket_attachments', 'support_ticket_history',
        'support_ticket_links', 'support_access_grants', 'support_access_events'
      )
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

ALTER POLICY "Support owners can upload ticket attachments" ON storage.objects TO authenticated;
ALTER POLICY "Support owners can view ticket attachments" ON storage.objects TO authenticated;
ALTER POLICY "Support owners can delete their ticket attachments" ON storage.objects TO authenticated;

-- 2. Helpers and RPC-only functions: signed-in users only.
REVOKE EXECUTE ON FUNCTION public.can_access_support_owner(text, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_support_ticket(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_support_storage_folder(text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.support_storage_object_is_internal(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.support_member_tenant_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_support_platform_operator() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.support_is_owner_admin(text, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.support_is_grantee_member(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.support_access_grant_active(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.support_access_grant_visible(uuid) FROM PUBLIC, anon;
-- Called by the set_ticket_number trigger as the inserting (signed-in) user.
REVOKE EXECUTE ON FUNCTION public.generate_ticket_number(text, uuid, uuid) FROM PUBLIC, anon;

-- 3. Trigger-only functions: no API role calls them directly. PostgreSQL
--    checks EXECUTE on a trigger function when the trigger is created, not
--    when it fires, so the triggers keep working.
REVOKE EXECUTE ON FUNCTION public.support_child_inherits_ticket_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.track_ticket_history() FROM PUBLIC, anon, authenticated;
