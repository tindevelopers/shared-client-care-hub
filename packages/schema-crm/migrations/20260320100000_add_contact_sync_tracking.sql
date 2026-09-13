-- Contact Sync Tracking
-- Adds GHL sync columns to contacts table and a dedicated sync log table.

-- ─── contacts table: new sync-tracking columns ───────────────────────────────

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_last_synced_at TIMESTAMPTZ;

-- Fast lookup by GHL contact ID (e.g. webhook dedup, outbound sync)
CREATE INDEX IF NOT EXISTS idx_contacts_ghl_contact_id
  ON contacts(ghl_contact_id)
  WHERE ghl_contact_id IS NOT NULL;

-- ─── contact_sync_log ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contact_sync_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        REFERENCES tenants(id) ON DELETE CASCADE,
  direction       TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  konnect_contact_id UUID,
  ghl_contact_id  TEXT,
  action          TEXT        NOT NULL CHECK (action IN ('created', 'updated', 'skipped', 'error')),
  error_message   TEXT,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contact_sync_log_tenant_id
  ON contact_sync_log(tenant_id);

CREATE INDEX IF NOT EXISTS idx_contact_sync_log_ghl_contact_id
  ON contact_sync_log(ghl_contact_id)
  WHERE ghl_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_sync_log_konnect_contact_id
  ON contact_sync_log(konnect_contact_id)
  WHERE konnect_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_sync_log_synced_at
  ON contact_sync_log(synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_sync_log_action
  ON contact_sync_log(tenant_id, action, synced_at DESC);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE contact_sync_log ENABLE ROW LEVEL SECURITY;

-- Platform admins can view all log entries
CREATE POLICY "Platform admins can view all contact sync logs"
  ON contact_sync_log FOR SELECT
  USING (is_platform_admin());

-- Platform admins can manage all log entries
CREATE POLICY "Platform admins can manage all contact sync logs"
  ON contact_sync_log FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Tenant users can view their own log entries
CREATE POLICY "Tenant users can view their contact sync logs"
  ON contact_sync_log FOR SELECT
  USING (tenant_id = get_current_tenant_id());

-- Tenant admins can manage their log entries
CREATE POLICY "Tenant admins can manage their contact sync logs"
  ON contact_sync_log FOR ALL
  USING (
    tenant_id = get_current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.tenant_id = get_current_tenant_id()
        AND users.role_id IN (SELECT id FROM roles WHERE name IN ('Platform Admin', 'Workspace Admin'))
    )
  )
  WITH CHECK (
    tenant_id = get_current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.tenant_id = get_current_tenant_id()
        AND users.role_id IN (SELECT id FROM roles WHERE name IN ('Platform Admin', 'Workspace Admin'))
    )
  );
