-- Canonical CRM contact lists, suppressions, and campaign status parity.
--
-- Rerunnable: additive DDL uses IF NOT EXISTS, functions use CREATE OR
-- REPLACE, and triggers/policies/constraints are dropped-if-exists before
-- recreation.
--
-- Security invariants enforced here:
--   * a suppression always references a contact in the SAME tenant
--     (composite FK onto contacts(tenant_id, id));
--   * suppression identity (tenant_id, contact_id, channel) is immutable, so
--     the legacy-flag projection can never go stale from a moved row;
--   * product tenant policies exclude Partner Admins — their only path into
--     CRM rows is the exact own-tenant partner policy
--     (20260919011000_partner_crm_full_parity_rls.sql), never the looser
--     users.tenant_id mapping.

ALTER TABLE public.contact_groups
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'list'
    CHECK (kind IN ('list', 'segment')),
  ADD COLUMN IF NOT EXISTS definition JSONB;

-- Composite FK target: lets contact_suppressions pin (tenant_id, contact_id)
-- to one contacts row so a suppression can never reference a cross-tenant
-- contact.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_id_id_key
  ON public.contacts (tenant_id, id);

CREATE TABLE IF NOT EXISTS public.contact_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  suppressed BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  source TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contact_suppressions_tenant_contact_channel_unique
    UNIQUE (tenant_id, contact_id, channel),
  CONSTRAINT contact_suppressions_tenant_contact_fkey
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES public.contacts (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contact_suppressions_tenant_id
  ON public.contact_suppressions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contact_suppressions_contact_id
  ON public.contact_suppressions(contact_id);

CREATE OR REPLACE FUNCTION public.project_contact_suppression()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    CASE OLD.channel
      WHEN 'email' THEN
        UPDATE public.contacts
        SET email_opt_out = false
        WHERE id = OLD.contact_id AND tenant_id = OLD.tenant_id;
      WHEN 'sms' THEN
        UPDATE public.contacts
        SET sms_opt_out = false
        WHERE id = OLD.contact_id AND tenant_id = OLD.tenant_id;
      WHEN 'whatsapp' THEN
        UPDATE public.contacts
        SET whatsapp_opt_out = false
        WHERE id = OLD.contact_id AND tenant_id = OLD.tenant_id;
    END CASE;
    RETURN OLD;
  END IF;

  -- Identity is immutable: moving a row to another tenant, contact, or
  -- channel would strand the legacy flag projected from the old identity.
  -- Delete the row and insert a new one instead.
  IF TG_OP = 'UPDATE'
     AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
          OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
          OR NEW.channel IS DISTINCT FROM OLD.channel) THEN
    RAISE EXCEPTION
      'contact_suppressions (tenant_id, contact_id, channel) is immutable; delete and re-insert to move a suppression';
  END IF;

  CASE NEW.channel
    WHEN 'email' THEN
      UPDATE public.contacts
      SET email_opt_out = NEW.suppressed
      WHERE id = NEW.contact_id AND tenant_id = NEW.tenant_id;
    WHEN 'sms' THEN
      UPDATE public.contacts
      SET sms_opt_out = NEW.suppressed
      WHERE id = NEW.contact_id AND tenant_id = NEW.tenant_id;
    WHEN 'whatsapp' THEN
      UPDATE public.contacts
      SET whatsapp_opt_out = NEW.suppressed
      WHERE id = NEW.contact_id AND tenant_id = NEW.tenant_id;
  END CASE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_contact_suppressions_updated_at
  ON public.contact_suppressions;
CREATE TRIGGER update_contact_suppressions_updated_at
  BEFORE UPDATE ON public.contact_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS project_contact_suppression_to_contacts
  ON public.contact_suppressions;
CREATE TRIGGER project_contact_suppression_to_contacts
  AFTER INSERT OR UPDATE OR DELETE ON public.contact_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.project_contact_suppression();

ALTER TABLE public.contact_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can manage all contact_suppressions"
  ON public.contact_suppressions;
CREATE POLICY "Platform admins can manage all contact_suppressions"
  ON public.contact_suppressions FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Product tenant policies: tenant users only. Partner Admins are excluded so
-- their sole access path is the exact own-tenant partner policy.
DROP POLICY IF EXISTS "Users can view contact_suppressions in their tenant"
  ON public.contact_suppressions;
CREATE POLICY "Users can view contact_suppressions in their tenant"
  ON public.contact_suppressions FOR SELECT
  USING (
    tenant_id = public.get_user_tenant_id()
    AND NOT public.current_user_is_partner_admin()
  );

DROP POLICY IF EXISTS "Users can insert contact_suppressions in their tenant"
  ON public.contact_suppressions;
CREATE POLICY "Users can insert contact_suppressions in their tenant"
  ON public.contact_suppressions FOR INSERT
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND NOT public.current_user_is_partner_admin()
  );

DROP POLICY IF EXISTS "Users can update contact_suppressions in their tenant"
  ON public.contact_suppressions;
CREATE POLICY "Users can update contact_suppressions in their tenant"
  ON public.contact_suppressions FOR UPDATE
  USING (
    tenant_id = public.get_user_tenant_id()
    AND NOT public.current_user_is_partner_admin()
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND NOT public.current_user_is_partner_admin()
  );

DROP POLICY IF EXISTS "Users can delete contact_suppressions in their tenant"
  ON public.contact_suppressions;
CREATE POLICY "Users can delete contact_suppressions in their tenant"
  ON public.contact_suppressions FOR DELETE
  USING (
    tenant_id = public.get_user_tenant_id()
    AND NOT public.current_user_is_partner_admin()
  );

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_status_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'sent'));
