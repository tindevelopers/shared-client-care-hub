-- Extend campaigns for marketing/email channel (Phase 4)
-- Depends on: 20260210000000 (campaigns, campaign_lists, campaign_recipients, campaign_events)
-- Depends on: 20260603110000 (integration_providers, integration_connections)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add 'email' to campaign_type CHECK constraint
-- ---------------------------------------------------------------------------
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_campaign_type_check;

ALTER TABLE campaigns ADD CONSTRAINT campaigns_campaign_type_check CHECK (
  campaign_type IN ('voice', 'sms', 'whatsapp', 'multi_channel', 'email')
);

-- ---------------------------------------------------------------------------
-- 2. Add marketing-specific columns to campaigns (additive, no data loss)
-- ---------------------------------------------------------------------------
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS provider TEXT;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS provider_campaign_id TEXT;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS template_ref TEXT;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS segment_ref TEXT;

COMMENT ON COLUMN campaigns.provider IS 'Provider slug (e.g., brevo) for marketing campaigns. NULL for voice/sms campaigns.';
COMMENT ON COLUMN campaigns.provider_campaign_id IS 'Provider-assigned campaign id. Used for status sync and reporting.';
COMMENT ON COLUMN campaigns.template_ref IS 'Reference to the provider template used (template id or key).';
COMMENT ON COLUMN campaigns.segment_ref IS 'Konnect segment definition key used for audience materialization.';

-- ---------------------------------------------------------------------------
-- 3. Add columns to campaign_recipients for email tracking
-- ---------------------------------------------------------------------------
ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS provider_recipient_id TEXT;

ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS engagement JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN campaign_recipients.provider_recipient_id IS 'Provider-assigned recipient/contact id for the send.';
COMMENT ON COLUMN campaign_recipients.provider_message_id IS 'Provider-assigned message id. Used for webhook correlation (Phase 3).';
COMMENT ON COLUMN campaign_recipients.engagement IS 'Engagement data (opens, clicks, bounces, complaints) synced from webhooks.';

-- ---------------------------------------------------------------------------
-- 4. Allow email to be NOT NULL for email campaigns (existing rows have email)
--    We keep it nullable for backward compat with voice/sms rows.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. Indexes for provider lookups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_campaigns_provider_campaign_id
  ON campaigns(provider_campaign_id)
  WHERE provider_campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_provider_message_id
  ON campaign_recipients(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMIT;
