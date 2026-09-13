-- Outbound Campaign Engine Tables
-- Campaigns, lists, recipients, and events for multi-channel outbound marketing

-- Campaigns table
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','paused','completed','cancelled')),
  campaign_type TEXT NOT NULL CHECK (campaign_type IN ('voice','sms','whatsapp','multi_channel')),
  -- Channel config
  assistant_id TEXT,
  from_number TEXT,
  message_template TEXT,
  -- Scheduling
  schedule_start TIMESTAMPTZ,
  schedule_end TIMESTAMPTZ,
  calling_window_start TIME DEFAULT '09:00',
  calling_window_end TIME DEFAULT '20:00',
  calling_days INTEGER[] DEFAULT '{1,2,3,4,5}',
  max_attempts INTEGER DEFAULT 3,
  retry_delay_minutes INTEGER DEFAULT 60,
  -- Throttling
  max_concurrent_calls INTEGER DEFAULT 5,
  calls_per_minute INTEGER DEFAULT 10,
  -- Metadata
  settings JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Campaign lists table (tracks imported lists)
CREATE TABLE campaign_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'csv','excel','google_sheets','airtable',
    'gohighlevel','hubspot','salesforce','pipedrive'
  )),
  source_config JSONB DEFAULT '{}',
  field_mapping JSONB DEFAULT '{}',
  total_records INTEGER DEFAULT 0,
  imported_records INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','importing','completed','failed')),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Campaign recipients table
CREATE TABLE campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  list_id UUID REFERENCES campaign_lists(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- Contact snapshot
  first_name TEXT NOT NULL,
  last_name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  client_type TEXT,
  custom_fields JSONB DEFAULT '{}',
  -- Execution state
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending','scheduled','in_progress','completed',
    'failed','skipped','opted_out','no_answer','voicemail'
  )),
  scheduled_at TIMESTAMPTZ,
  attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  call_control_id TEXT,
  conversation_id TEXT,
  result JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Campaign events table (audit trail)
CREATE TABLE campaign_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES campaign_recipients(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  channel TEXT,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_campaigns_tenant_id ON campaigns(tenant_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_created_at ON campaigns(created_at DESC);

CREATE INDEX idx_campaign_lists_tenant_id ON campaign_lists(tenant_id);
CREATE INDEX idx_campaign_lists_campaign_id ON campaign_lists(campaign_id);

CREATE INDEX idx_campaign_recipients_tenant_id ON campaign_recipients(tenant_id);
CREATE INDEX idx_campaign_recipients_campaign_id ON campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_status ON campaign_recipients(status);
CREATE INDEX idx_campaign_recipients_scheduled_at ON campaign_recipients(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_campaign_recipients_call_control_id ON campaign_recipients(call_control_id) WHERE call_control_id IS NOT NULL;

CREATE INDEX idx_campaign_events_tenant_id ON campaign_events(tenant_id);
CREATE INDEX idx_campaign_events_campaign_id ON campaign_events(campaign_id);
CREATE INDEX idx_campaign_events_recipient_id ON campaign_events(recipient_id);
CREATE INDEX idx_campaign_events_created_at ON campaign_events(created_at DESC);

-- Updated_at triggers
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_recipients_updated_at BEFORE UPDATE ON campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies: campaigns
CREATE POLICY "Platform admins can manage all campaigns"
  ON campaigns FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Users can view campaigns in their tenant"
  ON campaigns FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert campaigns in their tenant"
  ON campaigns FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update campaigns in their tenant"
  ON campaigns FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete campaigns in their tenant"
  ON campaigns FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies: campaign_lists
CREATE POLICY "Platform admins can manage all campaign_lists"
  ON campaign_lists FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Users can view campaign_lists in their tenant"
  ON campaign_lists FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert campaign_lists in their tenant"
  ON campaign_lists FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update campaign_lists in their tenant"
  ON campaign_lists FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete campaign_lists in their tenant"
  ON campaign_lists FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies: campaign_recipients
CREATE POLICY "Platform admins can manage all campaign_recipients"
  ON campaign_recipients FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Users can view campaign_recipients in their tenant"
  ON campaign_recipients FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert campaign_recipients in their tenant"
  ON campaign_recipients FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update campaign_recipients in their tenant"
  ON campaign_recipients FOR UPDATE
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete campaign_recipients in their tenant"
  ON campaign_recipients FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies: campaign_events
CREATE POLICY "Platform admins can manage all campaign_events"
  ON campaign_events FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "Users can view campaign_events in their tenant"
  ON campaign_events FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert campaign_events in their tenant"
  ON campaign_events FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
