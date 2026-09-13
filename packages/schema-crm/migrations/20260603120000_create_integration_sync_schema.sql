-- Integration sync schema: field_mappings, sync_state, processed_external_events
-- Depends on: integration_providers (20260603110000)

BEGIN;

-- ---------------------------------------------------------------------------
-- Field mappings: per-tenant, per-provider mapping of internal <-> external fields
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_slug TEXT NOT NULL,
  entity TEXT NOT NULL CHECK (entity IN ('contact', 'company', 'deal')),
  internal_field TEXT NOT NULL,
  external_field TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'bidirectional'
    CHECK (direction IN ('in', 'out', 'bidirectional')),
  conflict_policy TEXT NOT NULL DEFAULT 'newest_wins'
    CHECK (conflict_policy IN ('external_wins', 'internal_wins', 'newest_wins')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT field_mappings_unique_mapping
    UNIQUE (tenant_id, provider_slug, entity, internal_field)
);

CREATE INDEX IF NOT EXISTS idx_field_mappings_tenant_provider
  ON field_mappings(tenant_id, provider_slug);

-- ---------------------------------------------------------------------------
-- Sync state: tracks per-entity, per-provider sync position and conflicts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'company', 'deal')),
  entity_id UUID NOT NULL,
  provider_slug TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_direction TEXT NOT NULL DEFAULT 'out'
    CHECK (last_sync_direction IN ('in', 'out')),
  conflict_flag BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sync_state_entity_provider_unique
    UNIQUE (entity_type, entity_id, provider_slug)
);

CREATE INDEX IF NOT EXISTS idx_sync_state_tenant_provider
  ON sync_state(tenant_id, provider_slug);
CREATE INDEX IF NOT EXISTS idx_sync_state_conflict
  ON sync_state(tenant_id, conflict_flag) WHERE conflict_flag = true;

-- ---------------------------------------------------------------------------
-- Processed external events: webhook idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT processed_external_events_provider_event_unique
    UNIQUE (provider, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_external_events_provider
  ON processed_external_events(provider, processed_at DESC);

-- ---------------------------------------------------------------------------
-- Triggers for updated_at
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS update_field_mappings_updated_at ON field_mappings;
    CREATE TRIGGER update_field_mappings_updated_at
      BEFORE UPDATE ON field_mappings
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_sync_state_updated_at ON sync_state;
    CREATE TRIGGER update_sync_state_updated_at
      BEFORE UPDATE ON sync_state
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE field_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_external_events ENABLE ROW LEVEL SECURITY;

-- field_mappings: tenant-scoped
DROP POLICY IF EXISTS field_mappings_tenant_access ON field_mappings;
CREATE POLICY field_mappings_tenant_access ON field_mappings
  FOR ALL
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- sync_state: tenant can read; writes are service-role only
DROP POLICY IF EXISTS sync_state_tenant_read ON sync_state;
CREATE POLICY sync_state_tenant_read ON sync_state
  FOR SELECT
  USING (tenant_id = get_current_tenant_id());

-- processed_external_events: service role only (no user-facing RLS grants)

COMMIT;
