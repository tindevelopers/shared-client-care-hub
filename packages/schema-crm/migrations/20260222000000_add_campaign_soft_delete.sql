-- Add soft delete support for campaigns
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Speed up listing active campaigns per tenant
CREATE INDEX IF NOT EXISTS idx_campaigns_active_tenant_created
  ON campaigns(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
