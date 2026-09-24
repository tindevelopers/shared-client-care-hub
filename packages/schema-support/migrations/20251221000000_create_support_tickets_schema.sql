-- Support Ticketing System Tables
-- This migration creates tables for managing support tickets, threads, attachments, categories, and history
-- Based on UVdesk architecture

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Support Categories Table
CREATE TABLE IF NOT EXISTS support_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_categories_tenant_name_unique UNIQUE(tenant_id, name)
);

-- Support Tickets Table
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_number TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  category_id UUID REFERENCES support_categories(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT support_tickets_tenant_ticket_number_unique UNIQUE(tenant_id, ticket_number)
);

-- Support Ticket Threads Table (Comments/Replies)
CREATE TABLE IF NOT EXISTS support_ticket_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Support Ticket Attachments Table
CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES support_ticket_threads(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Support Ticket History Table (Audit Log)
CREATE TABLE IF NOT EXISTS support_ticket_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_support_categories_tenant_id ON support_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_categories_is_active ON support_categories(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_id ON support_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_status ON support_tickets(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_created_by ON support_tickets(tenant_id, created_by);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_assigned_to ON support_tickets(tenant_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_support_tickets_category_id ON support_tickets(category_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_number ON support_tickets(ticket_number);

CREATE INDEX IF NOT EXISTS idx_support_ticket_threads_ticket_id ON support_ticket_threads(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_threads_tenant_id ON support_ticket_threads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_threads_user_id ON support_ticket_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_threads_created_at ON support_ticket_threads(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket_id ON support_ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_thread_id ON support_ticket_attachments(thread_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_tenant_id ON support_ticket_attachments(tenant_id);

CREATE INDEX IF NOT EXISTS idx_support_ticket_history_ticket_id ON support_ticket_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_history_tenant_id ON support_ticket_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_history_created_at ON support_ticket_history(created_at DESC);

-- Create function to generate ticket number
CREATE OR REPLACE FUNCTION generate_ticket_number(p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  year_part TEXT;
  sequence_num INTEGER;
  ticket_num TEXT;
BEGIN
  year_part := TO_CHAR(NOW(), 'YYYY');
  
  -- Get the next sequence number for this tenant and year
  SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
  INTO sequence_num
  FROM support_tickets
  WHERE tenant_id = p_tenant_id
    AND ticket_number LIKE 'TKT-' || year_part || '-%';
  
  ticket_num := 'TKT-' || year_part || '-' || LPAD(sequence_num::TEXT, 5, '0');
  
  RETURN ticket_num;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate ticket number
CREATE OR REPLACE FUNCTION set_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := generate_ticket_number(NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_support_ticket_number
  BEFORE INSERT ON support_tickets
  FOR EACH ROW
  WHEN (NEW.ticket_number IS NULL OR NEW.ticket_number = '')
  EXECUTE FUNCTION set_ticket_number();

-- Create trigger to track ticket history
CREATE OR REPLACE FUNCTION track_ticket_history()
RETURNS TRIGGER AS $$
BEGIN
  -- Track status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO support_ticket_history (ticket_id, tenant_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, NEW.tenant_id, COALESCE(NEW.assigned_to, NEW.created_by), 'status', OLD.status, NEW.status);
  END IF;
  
  -- Track priority changes
  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    INSERT INTO support_ticket_history (ticket_id, tenant_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, NEW.tenant_id, COALESCE(NEW.assigned_to, NEW.created_by), 'priority', OLD.priority, NEW.priority);
  END IF;
  
  -- Track assignment changes
  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    INSERT INTO support_ticket_history (ticket_id, tenant_id, changed_by, field_name, old_value, new_value)
    VALUES (NEW.id, NEW.tenant_id, COALESCE(NEW.assigned_to, NEW.created_by), 'assigned_to', 
            COALESCE(OLD.assigned_to::TEXT, ''), COALESCE(NEW.assigned_to::TEXT, ''));
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER track_support_ticket_changes
  AFTER UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION track_ticket_history();

-- Add updated_at triggers
CREATE TRIGGER update_support_categories_updated_at BEFORE UPDATE ON support_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_support_tickets_updated_at BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_support_ticket_threads_updated_at BEFORE UPDATE ON support_ticket_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE support_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for support_categories
-- Platform admins can view all categories
CREATE POLICY "Platform admins can view all support categories"
  ON support_categories FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  );

-- Users can view categories in their tenant
CREATE POLICY "Users can view support categories in their tenant"
  ON support_categories FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id IN (
      SELECT tenant_id 
      FROM public.users 
      WHERE id = auth.uid()
      AND tenant_id IS NOT NULL
    )
  );

-- Users can insert categories in their tenant
CREATE POLICY "Users can insert support categories in their tenant"
  ON support_categories FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND tenant_id IN (
      SELECT tenant_id 
      FROM public.users 
      WHERE id = auth.uid()
      AND tenant_id IS NOT NULL
    )
  );

-- Users can update categories in their tenant
CREATE POLICY "Users can update support categories in their tenant"
  ON support_categories FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id IN (
      SELECT tenant_id 
      FROM public.users 
      WHERE id = auth.uid()
      AND tenant_id IS NOT NULL
    )
  );

-- Users can delete categories in their tenant
CREATE POLICY "Users can delete support categories in their tenant"
  ON support_categories FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id IN (
      SELECT tenant_id 
      FROM public.users 
      WHERE id = auth.uid()
      AND tenant_id IS NOT NULL
    )
  );

-- Platform admins can manage all categories
CREATE POLICY "Platform admins can manage all support categories"
  ON support_categories FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  );

-- RLS Policies for support_tickets
-- Platform admins can view all tickets
CREATE POLICY "Platform admins can view all support tickets"
  ON support_tickets FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  );

-- Customers can view tickets they created
CREATE POLICY "Customers can view their own support tickets"
  ON support_tickets FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

-- Agents can view all tickets in their tenant
CREATE POLICY "Agents can view support tickets in their tenant"
  ON support_tickets FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id IN (
      SELECT tenant_id 
      FROM public.users 
      WHERE id = auth.uid()
      AND tenant_id IS NOT NULL
    )
  );

-- Customers can create tickets
CREATE POLICY "Customers can create support tickets"
  ON support_tickets FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND tenant_id IN (
      SELECT tenant_id 
      FROM public.users 
      WHERE id = auth.uid()
      AND tenant_id IS NOT NULL
    )
  );

-- Agents can create tickets in their tenant
CREATE POLICY "Agents can create support tickets in their tenant"
  ON support_tickets FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND tenant_id IN (
      SELECT tenant_id 
      FROM public.users 
      WHERE id = auth.uid()
      AND tenant_id IS NOT NULL
    )
  );

-- Customers can update their own tickets
CREATE POLICY "Customers can update their own support tickets"
  ON support_tickets FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

-- Agents can update tickets in their tenant
CREATE POLICY "Agents can update support tickets in their tenant"
  ON support_tickets FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND tenant_id IN (
      SELECT tenant_id 
      FROM public.users 
      WHERE id = auth.uid()
      AND tenant_id IS NOT NULL
    )
  );

-- Platform admins can manage all tickets
CREATE POLICY "Platform admins can manage all support tickets"
  ON support_tickets FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  );

-- RLS Policies for support_ticket_threads
-- Platform admins can view all threads
CREATE POLICY "Platform admins can view all support ticket threads"
  ON support_ticket_threads FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  );

-- Users can view threads for tickets they can access
CREATE POLICY "Users can view support ticket threads for accessible tickets"
  ON support_ticket_threads FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      -- Can view if ticket is created by them
      ticket_id IN (SELECT id FROM support_tickets WHERE created_by = auth.uid())
      OR
      -- Can view if ticket is in their tenant (agents)
      tenant_id IN (
        SELECT tenant_id 
        FROM public.users 
        WHERE id = auth.uid()
        AND tenant_id IS NOT NULL
      )
    )
  );

-- Users can create threads for tickets they can access
CREATE POLICY "Users can create support ticket threads"
  ON support_ticket_threads FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND (
      -- Can create if ticket is created by them
      ticket_id IN (SELECT id FROM support_tickets WHERE created_by = auth.uid())
      OR
      -- Can create if ticket is in their tenant (agents)
      tenant_id IN (
        SELECT tenant_id 
        FROM public.users 
        WHERE id = auth.uid()
        AND tenant_id IS NOT NULL
      )
    )
  );

-- Users can update their own threads
CREATE POLICY "Users can update their own support ticket threads"
  ON support_ticket_threads FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
  );

-- Platform admins can manage all threads
CREATE POLICY "Platform admins can manage all support ticket threads"
  ON support_ticket_threads FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  );

-- RLS Policies for support_ticket_attachments
-- Platform admins can view all attachments
CREATE POLICY "Platform admins can view all support ticket attachments"
  ON support_ticket_attachments FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  );

-- Users can view attachments for tickets they can access
CREATE POLICY "Users can view support ticket attachments for accessible tickets"
  ON support_ticket_attachments FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      -- Can view if ticket is created by them
      ticket_id IN (SELECT id FROM support_tickets WHERE created_by = auth.uid())
      OR
      -- Can view if ticket is in their tenant (agents)
      tenant_id IN (
        SELECT tenant_id 
        FROM public.users 
        WHERE id = auth.uid()
        AND tenant_id IS NOT NULL
      )
    )
  );

-- Users can create attachments for tickets they can access
CREATE POLICY "Users can create support ticket attachments"
  ON support_ticket_attachments FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND uploaded_by = auth.uid()
    AND (
      -- Can create if ticket is created by them
      ticket_id IN (SELECT id FROM support_tickets WHERE created_by = auth.uid())
      OR
      -- Can create if ticket is in their tenant (agents)
      tenant_id IN (
        SELECT tenant_id 
        FROM public.users 
        WHERE id = auth.uid()
        AND tenant_id IS NOT NULL
      )
    )
  );

-- Users can delete their own attachments
CREATE POLICY "Users can delete their own support ticket attachments"
  ON support_ticket_attachments FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND uploaded_by = auth.uid()
  );

-- Platform admins can manage all attachments
CREATE POLICY "Platform admins can manage all support ticket attachments"
  ON support_ticket_attachments FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  );

-- RLS Policies for support_ticket_history
-- Platform admins can view all history
CREATE POLICY "Platform admins can view all support ticket history"
  ON support_ticket_history FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 
      FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.id = auth.uid()
      AND r.name = 'Platform Admin'
      AND u.tenant_id IS NULL
    )
  );

-- Users can view history for tickets they can access
CREATE POLICY "Users can view support ticket history for accessible tickets"
  ON support_ticket_history FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (
      -- Can view if ticket is created by them
      ticket_id IN (SELECT id FROM support_tickets WHERE created_by = auth.uid())
      OR
      -- Can view if ticket is in their tenant (agents)
      tenant_id IN (
        SELECT tenant_id 
        FROM public.users 
        WHERE id = auth.uid()
        AND tenant_id IS NOT NULL
      )
    )
  );

-- Only system can insert history (via trigger)
CREATE POLICY "System can insert support ticket history"
  ON support_ticket_history FOR INSERT
  WITH CHECK (true);

-- Create Storage Bucket for Support Ticket Attachments
-- Note: This requires the storage extension to be enabled
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-tickets',
  'support-tickets',
  false, -- Private bucket - uses signed URLs for access
  52428800, -- 50MB file size limit
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies for support-tickets bucket
-- Users can upload files to their tenant's folder
CREATE POLICY "Users can upload support ticket attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'support-tickets'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::TEXT 
      FROM users 
      WHERE id = auth.uid()
      AND tenant_id IS NOT NULL
    )
  );

-- Users can view attachments for tickets they can access
CREATE POLICY "Users can view support ticket attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'support-tickets'
    AND auth.uid() IS NOT NULL
    AND (
      -- Can view if in their tenant's folder
      (storage.foldername(name))[1] IN (
        SELECT tenant_id::TEXT 
        FROM users 
        WHERE id = auth.uid()
        AND tenant_id IS NOT NULL
      )
      OR
      -- Platform admins can view all
      EXISTS (
        SELECT 1 
        FROM public.users u
        JOIN public.roles r ON u.role_id = r.id
        WHERE u.id = auth.uid()
        AND r.name = 'Platform Admin'
        AND u.tenant_id IS NULL
      )
    )
  );

-- Users can delete their own uploaded files
CREATE POLICY "Users can delete support ticket attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'support-tickets'
    AND auth.uid() IS NOT NULL
    AND (
      -- Can delete if uploaded by them (check via metadata or folder structure)
      (storage.foldername(name))[1] IN (
        SELECT tenant_id::TEXT 
        FROM users 
        WHERE id = auth.uid()
        AND tenant_id IS NOT NULL
      )
      OR
      -- Platform admins can delete all
      EXISTS (
        SELECT 1 
        FROM public.users u
        JOIN public.roles r ON u.role_id = r.id
        WHERE u.id = auth.uid()
        AND r.name = 'Platform Admin'
        AND u.tenant_id IS NULL
      )
    )
  );

