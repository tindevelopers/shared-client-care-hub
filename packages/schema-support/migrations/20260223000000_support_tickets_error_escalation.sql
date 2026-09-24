-- Add error context and escalation fields to support_tickets
-- Used when tickets are created from failed user actions (support code + ref)
-- and for org admin -> platform admin escalation

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS support_code TEXT,
  ADD COLUMN IF NOT EXISTS support_ref TEXT,
  ADD COLUMN IF NOT EXISTS escalated_to_platform_admin_at TIMESTAMPTZ;

COMMENT ON COLUMN support_tickets.support_code IS 'Public support code from failed action (e.g. KX-NUM-004)';
COMMENT ON COLUMN support_tickets.support_ref IS 'Reference id from error (e.g. ref_xxx)';
COMMENT ON COLUMN support_tickets.escalated_to_platform_admin_at IS 'When set, ticket was escalated from org admin to platform admin';

CREATE INDEX IF NOT EXISTS idx_support_tickets_support_code ON support_tickets(support_code) WHERE support_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_escalated ON support_tickets(escalated_to_platform_admin_at) WHERE escalated_to_platform_admin_at IS NOT NULL;
