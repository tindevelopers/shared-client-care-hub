-- Fix RLS recursion in CRM tables
-- The CRM RLS policies were querying the users table directly, causing infinite recursion
-- Solution: Add Platform Admin policies first, then fix regular policies to avoid recursion

-- Drop existing CRM policies
DROP POLICY IF EXISTS "Users can view companies in their tenant" ON companies;
DROP POLICY IF EXISTS "Users can insert companies in their tenant" ON companies;
DROP POLICY IF EXISTS "Users can update companies in their tenant" ON companies;
DROP POLICY IF EXISTS "Users can delete companies in their tenant" ON companies;

DROP POLICY IF EXISTS "Users can view contacts in their tenant" ON contacts;
DROP POLICY IF EXISTS "Users can insert contacts in their tenant" ON contacts;
DROP POLICY IF EXISTS "Users can update contacts in their tenant" ON contacts;
DROP POLICY IF EXISTS "Users can delete contacts in their tenant" ON contacts;

DROP POLICY IF EXISTS "Users can view deal_stages in their tenant" ON deal_stages;
DROP POLICY IF EXISTS "Users can insert deal_stages in their tenant" ON deal_stages;
DROP POLICY IF EXISTS "Users can update deal_stages in their tenant" ON deal_stages;
DROP POLICY IF EXISTS "Users can delete deal_stages in their tenant" ON deal_stages;

DROP POLICY IF EXISTS "Users can view deals in their tenant" ON deals;
DROP POLICY IF EXISTS "Users can insert deals in their tenant" ON deals;
DROP POLICY IF EXISTS "Users can update deals in their tenant" ON deals;
DROP POLICY IF EXISTS "Users can delete deals in their tenant" ON deals;

DROP POLICY IF EXISTS "Users can view tasks in their tenant" ON tasks;
DROP POLICY IF EXISTS "Users can insert tasks in their tenant" ON tasks;
DROP POLICY IF EXISTS "Users can update tasks in their tenant" ON tasks;
DROP POLICY IF EXISTS "Users can delete tasks in their tenant" ON tasks;

DROP POLICY IF EXISTS "Users can view notes in their tenant" ON notes;
DROP POLICY IF EXISTS "Users can insert notes in their tenant" ON notes;
DROP POLICY IF EXISTS "Users can update notes in their tenant" ON notes;
DROP POLICY IF EXISTS "Users can delete notes in their tenant" ON notes;

DROP POLICY IF EXISTS "Users can view activities in their tenant" ON activities;
DROP POLICY IF EXISTS "Users can insert activities in their tenant" ON activities;

-- Create a helper function to get user tenant_id without triggering RLS recursion
-- This function uses SECURITY DEFINER to bypass RLS when querying users table
CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_tenant_id UUID;
BEGIN
  -- Use SECURITY DEFINER to bypass RLS when querying users table
  SELECT tenant_id INTO user_tenant_id
  FROM users
  WHERE id = auth.uid();
  
  RETURN user_tenant_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_user_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_tenant_id() TO anon;

-- Companies: Platform Admin policies (allow all operations)
CREATE POLICY "Platform admins can manage all companies"
  ON companies FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Companies: Regular user policies (use helper function to avoid recursion)
CREATE POLICY "Users can view companies in their tenant"
  ON companies FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert companies in their tenant"
  ON companies FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update companies in their tenant"
  ON companies FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete companies in their tenant"
  ON companies FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Contacts: Platform Admin policies
CREATE POLICY "Platform admins can manage all contacts"
  ON contacts FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Contacts: Regular user policies
CREATE POLICY "Users can view contacts in their tenant"
  ON contacts FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert contacts in their tenant"
  ON contacts FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update contacts in their tenant"
  ON contacts FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete contacts in their tenant"
  ON contacts FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Deal Stages: Platform Admin policies
CREATE POLICY "Platform admins can manage all deal_stages"
  ON deal_stages FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Deal Stages: Regular user policies
CREATE POLICY "Users can view deal_stages in their tenant"
  ON deal_stages FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert deal_stages in their tenant"
  ON deal_stages FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update deal_stages in their tenant"
  ON deal_stages FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete deal_stages in their tenant"
  ON deal_stages FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Deals: Platform Admin policies
CREATE POLICY "Platform admins can manage all deals"
  ON deals FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Deals: Regular user policies
CREATE POLICY "Users can view deals in their tenant"
  ON deals FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert deals in their tenant"
  ON deals FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update deals in their tenant"
  ON deals FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete deals in their tenant"
  ON deals FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Tasks: Platform Admin policies
CREATE POLICY "Platform admins can manage all tasks"
  ON tasks FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Tasks: Regular user policies
CREATE POLICY "Users can view tasks in their tenant"
  ON tasks FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert tasks in their tenant"
  ON tasks FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update tasks in their tenant"
  ON tasks FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete tasks in their tenant"
  ON tasks FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Notes: Platform Admin policies
CREATE POLICY "Platform admins can manage all notes"
  ON notes FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Notes: Regular user policies
CREATE POLICY "Users can view notes in their tenant"
  ON notes FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert notes in their tenant"
  ON notes FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update notes in their tenant"
  ON notes FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete notes in their tenant"
  ON notes FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Activities: Platform Admin policies
CREATE POLICY "Platform admins can manage all activities"
  ON activities FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Activities: Regular user policies
CREATE POLICY "Users can view activities in their tenant"
  ON activities FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert activities in their tenant"
  ON activities FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
