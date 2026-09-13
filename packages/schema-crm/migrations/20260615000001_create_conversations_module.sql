-- Conversations Module — Data Model (Phase 1)
-- Campaign-independent canonical conversations and messages tables.
-- Resolves: tenant → contact → channel → conversation → messages.
-- Tenant-isolated with GUC-based RLS + platform-admin bypass.

BEGIN;

-- ============================================================================
-- conversations — campaign-independent thread per contact+channel
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  primary_channel TEXT NOT NULL
    CHECK (primary_channel IN ('sms', 'whatsapp', 'email', 'voice', 'manual')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'snoozed', 'closed')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,
  labels TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'inbound'
    CHECK (source IN ('inbound', 'campaign', 'automation', 'manual')),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversations_contact_channel_unique
    UNIQUE (tenant_id, contact_id, primary_channel)
);

-- ============================================================================
-- messages — canonical channel-agnostic message log
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL
    CHECK (channel IN ('sms', 'whatsapp', 'email', 'voice', 'manual', 'internal')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  author_type TEXT DEFAULT 'contact'
    CHECK (author_type IN ('contact', 'agent', 'ai', 'system')),
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT,
  body_original TEXT,
  detected_language TEXT,
  translated BOOLEAN NOT NULL DEFAULT false,
  provider TEXT,
  provider_message_id TEXT,
  delivery_status TEXT DEFAULT 'received'
    CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'rejected', 'received')),
  is_internal_note BOOLEAN NOT NULL DEFAULT false,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  automation_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-tenant/channel provider dedup (partial index: NULL provider_message_id rows not deduped)
CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_dedup
  ON messages (tenant_id, channel, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ============================================================================
-- contact_channels — inbound identity resolution
-- ============================================================================
CREATE TABLE IF NOT EXISTS contact_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email', 'voice')),
  address TEXT NOT NULL,
  normalized_address TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contact_channels_tenant_channel_addr_unique
    UNIQUE (tenant_id, channel, normalized_address)
);

-- ============================================================================
-- message_attachments — future media support
-- ============================================================================
CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  storage_path TEXT,
  url TEXT,
  mime_type TEXT,
  size BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Contact extensions — additive columns for multi-channel identity
-- ============================================================================
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS whatsapp_id TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS whatsapp_opt_out BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS dnc BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- Row Level Security — GUC-based tenant isolation + platform-admin bypass
-- ============================================================================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

-- conversations
DROP POLICY IF EXISTS conversations_tenant_access ON conversations;
DROP POLICY IF EXISTS "conversations_tenant_access" ON conversations;
CREATE POLICY conversations_tenant_access ON conversations
  FOR ALL
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS "Platform admins manage conversations" ON conversations;
CREATE POLICY "Platform admins manage conversations" ON conversations
  FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- messages
DROP POLICY IF EXISTS messages_tenant_access ON messages;
DROP POLICY IF EXISTS "messages_tenant_access" ON messages;
CREATE POLICY messages_tenant_access ON messages
  FOR ALL
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS "Platform admins manage messages" ON messages;
CREATE POLICY "Platform admins manage messages" ON messages
  FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- contact_channels
DROP POLICY IF EXISTS contact_channels_tenant_access ON contact_channels;
DROP POLICY IF EXISTS "contact_channels_tenant_access" ON contact_channels;
CREATE POLICY contact_channels_tenant_access ON contact_channels
  FOR ALL
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS "Platform admins manage contact_channels" ON contact_channels;
CREATE POLICY "Platform admins manage contact_channels" ON contact_channels
  FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- message_attachments
DROP POLICY IF EXISTS message_attachments_tenant_access ON message_attachments;
DROP POLICY IF EXISTS "message_attachments_tenant_access" ON message_attachments;
CREATE POLICY message_attachments_tenant_access ON message_attachments
  FOR ALL
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS "Platform admins manage message_attachments" ON message_attachments;
CREATE POLICY "Platform admins manage message_attachments" ON message_attachments
  FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ============================================================================
-- Indexes
-- ============================================================================

-- Conversations: fast inbox views
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_status_assigned
  ON conversations (tenant_id, status, assigned_to);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id
  ON conversations (contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
  ON conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_labels
  ON conversations USING GIN (labels);

-- Messages: timeline queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_contact_created
  ON messages (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_created
  ON messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_campaign_id
  ON messages (campaign_id);

-- Contact channels: identity lookups
CREATE INDEX IF NOT EXISTS idx_contact_channels_tenant_channel_addr
  ON contact_channels (tenant_id, channel, normalized_address);

-- Message attachments: message-level lookups
CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id
  ON message_attachments (message_id);

-- ============================================================================
-- Updated_at triggers
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
    CREATE TRIGGER update_conversations_updated_at
      BEFORE UPDATE ON conversations
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_contact_channels_updated_at ON contact_channels;
    CREATE TRIGGER update_contact_channels_updated_at
      BEFORE UPDATE ON contact_channels
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMIT;