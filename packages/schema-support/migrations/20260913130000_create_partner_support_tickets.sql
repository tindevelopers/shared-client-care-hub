-- 20260913130000_create_partner_support_tickets.sql
-- Partner support ticket queue: tickets + threaded replies.
-- RLS ownership mirrors partner_tenants: Partner Admins see/manage only
-- their partner's tickets; Platform Admins manage everything.

CREATE TABLE IF NOT EXISTS partner_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  subject text NOT NULL,
  details text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_support_tickets_partner_status
  ON partner_support_tickets(partner_id, status);

CREATE TABLE IF NOT EXISTS partner_support_ticket_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES partner_support_tickets(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_support_ticket_replies_ticket
  ON partner_support_ticket_replies(ticket_id, created_at);

DROP TRIGGER IF EXISTS update_partner_support_tickets_updated_at ON partner_support_tickets;
CREATE TRIGGER update_partner_support_tickets_updated_at BEFORE UPDATE ON partner_support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE partner_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_support_ticket_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins can manage support tickets" ON partner_support_tickets;
CREATE POLICY "Platform admins can manage support tickets"
  ON partner_support_tickets FOR ALL
  USING (public.get_current_user_role() = 'Platform Admin')
  WITH CHECK (public.get_current_user_role() = 'Platform Admin');

DROP POLICY IF EXISTS "Partner admins can manage their support tickets" ON partner_support_tickets;
CREATE POLICY "Partner admins can manage their support tickets"
  ON partner_support_tickets FOR ALL
  USING (
    public.current_user_is_partner_admin()
    AND partner_id = public.get_current_user_partner_id()
  )
  WITH CHECK (
    public.current_user_is_partner_admin()
    AND partner_id = public.get_current_user_partner_id()
  );

DROP POLICY IF EXISTS "Platform admins can manage ticket replies" ON partner_support_ticket_replies;
CREATE POLICY "Platform admins can manage ticket replies"
  ON partner_support_ticket_replies FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM partner_support_tickets t
      WHERE t.id = partner_support_ticket_replies.ticket_id
        AND public.get_current_user_role() = 'Platform Admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM partner_support_tickets t
      WHERE t.id = partner_support_ticket_replies.ticket_id
        AND public.get_current_user_role() = 'Platform Admin'
    )
  );

DROP POLICY IF EXISTS "Partner admins can manage their ticket replies" ON partner_support_ticket_replies;
CREATE POLICY "Partner admins can manage their ticket replies"
  ON partner_support_ticket_replies FOR ALL
  USING (
    public.current_user_is_partner_admin()
    AND EXISTS (
      SELECT 1 FROM partner_support_tickets t
      WHERE t.id = partner_support_ticket_replies.ticket_id
        AND t.partner_id = public.get_current_user_partner_id()
    )
  )
  WITH CHECK (
    public.current_user_is_partner_admin()
    AND EXISTS (
      SELECT 1 FROM partner_support_tickets t
      WHERE t.id = partner_support_ticket_replies.ticket_id
        AND t.partner_id = public.get_current_user_partner_id()
    )
  );
