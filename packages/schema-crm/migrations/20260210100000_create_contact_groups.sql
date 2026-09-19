-- Contact Groups & Membership
-- Allows organizing contacts into groups for campaign targeting

-- Contact Groups table
CREATE TABLE contact_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contact_groups_tenant_name_unique UNIQUE(tenant_id, name)
);

-- Contact Group Members (join table)
CREATE TABLE contact_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contact_group_members_unique UNIQUE(group_id, contact_id)
);

-- Indexes
CREATE INDEX idx_contact_groups_tenant_id ON contact_groups(tenant_id);
CREATE INDEX idx_contact_groups_name ON contact_groups(tenant_id, name);

CREATE INDEX idx_contact_group_members_group_id ON contact_group_members(group_id);
CREATE INDEX idx_contact_group_members_contact_id ON contact_group_members(contact_id);
CREATE INDEX idx_contact_group_members_tenant_id ON contact_group_members(tenant_id);

-- Updated_at trigger
CREATE TRIGGER update_contact_groups_updated_at BEFORE UPDATE ON contact_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE contact_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_group_members ENABLE ROW LEVEL SECURITY;

-- RLS Policies: contact_groups
CREATE POLICY "Platform admins can manage all contact_groups"
  ON contact_groups FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Users can view contact_groups in their tenant"
  ON contact_groups FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert contact_groups in their tenant"
  ON contact_groups FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update contact_groups in their tenant"
  ON contact_groups FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete contact_groups in their tenant"
  ON contact_groups FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies: contact_group_members
CREATE POLICY "Platform admins can manage all contact_group_members"
  ON contact_group_members FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Users can view contact_group_members in their tenant"
  ON contact_group_members FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert contact_group_members in their tenant"
  ON contact_group_members FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update contact_group_members in their tenant"
  ON contact_group_members FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete contact_group_members in their tenant"
  ON contact_group_members FOR DELETE
  USING (tenant_id = get_user_tenant_id());
