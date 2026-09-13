-- Conversation Engine: conversation_turns table, campaign/recipient/contact extensions
-- Implements two-way SMS text conversations with dedup, delivery tracking, and guardrails
-- Depends on: campaign_tables (20260210000000), contacts (20251208000000), RLS infrastructure

BEGIN;

-- ============================================================================
-- conversation_turns table — canonical chat history for multi-turn conversations
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES campaign_recipients(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'voice', 'email')),
  turn_index INTEGER NOT NULL DEFAULT 1,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  content TEXT,
  intent TEXT,
  next_action TEXT,
  provider_message_id TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'failed', 'rejected')),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- BLOCKER 1: dedup lock — two concurrent webhooks with same provider_message_id
  -- cannot both INSERT; exactly one succeeds
  CONSTRAINT conversation_turns_provider_message_id_unique UNIQUE (provider_message_id)
);

-- ============================================================================
-- Campaign extensions: conversation guardrail settings with safe defaults
-- ============================================================================
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS max_conversation_turns INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS no_reply_timeout_minutes INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS max_sends_per_recipient INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS global_send_rate_per_minute INTEGER NOT NULL DEFAULT 60;

-- ============================================================================
-- Campaign recipient extensions: per-recipient conversation state
-- ============================================================================
ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS conversation_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS last_turn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS turn_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_opt_out BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- Contacts extension: platform-wide SMS opt-out (BLOCKER 3)
-- ============================================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS sms_opt_out BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- Indexes for query performance
-- ============================================================================

-- Fast AI context queries: all turns for a recipient within a campaign
CREATE INDEX IF NOT EXISTS idx_conversation_turns_tenant_campaign_recipient_turn
  ON conversation_turns(tenant_id, campaign_id, recipient_id, turn_index);

-- DESC index for "last N turns" lookups (AI context builder)
CREATE INDEX IF NOT EXISTS idx_conversation_turns_recipient_campaign_turn_desc
  ON conversation_turns(recipient_id, campaign_id, turn_index DESC);

-- Delivery status scanning for retry/reconciliation workers
CREATE INDEX IF NOT EXISTS idx_conversation_turns_delivery_status_created
  ON conversation_turns(delivery_status, created_at);

-- No-reply timeout scanner: find stuck awaiting_reply recipients
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_conversation_status_last_turn
  ON campaign_recipients(conversation_status, last_turn_at);

-- ============================================================================
-- Updated_at trigger
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS update_conversation_turns_updated_at ON conversation_turns;
    CREATE TRIGGER update_conversation_turns_updated_at
      BEFORE UPDATE ON conversation_turns
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;

-- Platform admin bypass: full access for platform administrators
DROP POLICY IF EXISTS "Platform admins can manage all conversation_turns" ON conversation_turns;
CREATE POLICY "Platform admins can manage all conversation_turns"
  ON conversation_turns FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Tenant-scoped access: users can only access turns in their current tenant
DROP POLICY IF EXISTS conversation_turns_tenant_access ON conversation_turns;
DROP POLICY IF EXISTS "conversation_turns_tenant_access" ON conversation_turns;
CREATE POLICY conversation_turns_tenant_access ON conversation_turns
  FOR ALL
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

COMMIT;