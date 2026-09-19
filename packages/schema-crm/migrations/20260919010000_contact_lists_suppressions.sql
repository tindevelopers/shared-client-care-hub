-- Canonical CRM contact lists, suppressions, and campaign status parity.

ALTER TABLE public.contact_groups
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'list'
    CHECK (kind IN ('list', 'segment')),
  ADD COLUMN IF NOT EXISTS definition JSONB;

CREATE TABLE public.contact_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  suppressed BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  source TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contact_suppressions_tenant_contact_channel_unique
    UNIQUE (tenant_id, contact_id, channel)
);

CREATE INDEX idx_contact_suppressions_tenant_id
  ON public.contact_suppressions(tenant_id);
CREATE INDEX idx_contact_suppressions_contact_id
  ON public.contact_suppressions(contact_id);

CREATE TRIGGER update_contact_suppressions_updated_at
  BEFORE UPDATE ON public.contact_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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

CREATE TRIGGER project_contact_suppression_to_contacts
  AFTER INSERT OR UPDATE OR DELETE ON public.contact_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.project_contact_suppression();

ALTER TABLE public.contact_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins can manage all contact_suppressions"
  ON public.contact_suppressions FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Users can view contact_suppressions in their tenant"
  ON public.contact_suppressions FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can insert contact_suppressions in their tenant"
  ON public.contact_suppressions FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update contact_suppressions in their tenant"
  ON public.contact_suppressions FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can delete contact_suppressions in their tenant"
  ON public.contact_suppressions FOR DELETE
  USING (tenant_id = public.get_user_tenant_id());

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_status_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'sent'));
