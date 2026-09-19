-- CRM list-membership tenant consistency and canonical suppression actor.
--
-- Additive follow-up to 20260919010000_contact_lists_suppressions.sql for
-- databases that already applied the Task 3 migration: nothing here edits the
-- prior file, so already-migrated databases upgrade cleanly.
--
-- Rerunnable: ADD COLUMN / CREATE INDEX use IF NOT EXISTS, constraints are
-- dropped-if-exists before recreation, and the membership cleanup DELETE is
-- idempotent.
--
-- Security invariants enforced here:
--   * list membership is tenant-consistent: contact_group_members pins BOTH
--     (tenant_id, group_id) and (tenant_id, contact_id) via composite FKs, so
--     an own-tenant member row can never reference another tenant's group or
--     contact;
--   * suppressions carry their acting user in a dedicated nullable
--     updated_by column instead of a metadata convention.

-- Canonical actor column: who last set/unset this suppression (NULL for
-- system-driven writes).
ALTER TABLE public.contact_suppressions
  ADD COLUMN IF NOT EXISTS updated_by UUID
    REFERENCES public.users(id) ON DELETE SET NULL;

-- Composite FK target: a member row pins (tenant_id, group_id) to one
-- contact_groups row. (contacts(tenant_id, id) was keyed by 20260919010000.)
CREATE UNIQUE INDEX IF NOT EXISTS contact_groups_tenant_id_id_key
  ON public.contact_groups (tenant_id, id);

-- Upgrade safety: remove ONLY invalid membership edges — rows whose group or
-- contact does not exist in the SAME tenant. Valid memberships are preserved.
-- After the composite FKs below, such rows can never be created again.
DELETE FROM public.contact_group_members AS m
WHERE NOT EXISTS (
        SELECT 1
        FROM public.contact_groups AS g
        WHERE g.id = m.group_id
          AND g.tenant_id = m.tenant_id
      )
   OR NOT EXISTS (
        SELECT 1
        FROM public.contacts AS c
        WHERE c.id = m.contact_id
          AND c.tenant_id = m.tenant_id
      );

-- Replace the permissive single-column FKs from 20260210100000 with
-- tenant-consistent composite FKs.
ALTER TABLE public.contact_group_members
  DROP CONSTRAINT IF EXISTS contact_group_members_group_id_fkey;
ALTER TABLE public.contact_group_members
  DROP CONSTRAINT IF EXISTS contact_group_members_contact_id_fkey;

ALTER TABLE public.contact_group_members
  DROP CONSTRAINT IF EXISTS contact_group_members_tenant_group_fkey;
ALTER TABLE public.contact_group_members
  ADD CONSTRAINT contact_group_members_tenant_group_fkey
    FOREIGN KEY (tenant_id, group_id)
    REFERENCES public.contact_groups (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.contact_group_members
  DROP CONSTRAINT IF EXISTS contact_group_members_tenant_contact_fkey;
ALTER TABLE public.contact_group_members
  ADD CONSTRAINT contact_group_members_tenant_contact_fkey
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES public.contacts (tenant_id, id) ON DELETE CASCADE;
