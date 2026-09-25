-- Custom field definitions: per-tenant admin-defined fields for contacts/companies/deals
-- Enables tenants to extend CRM entities without code changes

BEGIN;

CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity TEXT NOT NULL CHECK (entity IN ('contact', 'company', 'deal')),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN (
    'text', 'number', 'date', 'select', 'multiselect',
    'boolean', 'url', 'email', 'phone'
  )),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  required BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT custom_field_definitions_tenant_entity_key_unique
    UNIQUE(tenant_id, entity, key)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_tenant_entity
  ON custom_field_definitions(tenant_id, entity);

ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;

-- RLS: tenant-scoped access via existing get_current_tenant_id()
DROP POLICY IF EXISTS custom_field_definitions_tenant_access ON custom_field_definitions;
CREATE POLICY custom_field_definitions_tenant_access ON custom_field_definitions
  FOR ALL
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- updated_at trigger
DROP TRIGGER IF EXISTS update_custom_field_definitions_updated_at ON custom_field_definitions;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE TRIGGER update_custom_field_definitions_updated_at
      BEFORE UPDATE ON custom_field_definitions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMIT;
