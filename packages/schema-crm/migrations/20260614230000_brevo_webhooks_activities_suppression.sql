-- Extend activities table with webhook event types and add suppression column
-- Depends on: 20251208000000 (crm tables: contacts, activities)
-- Depends on: 20260603110000 (integration_providers, integration_connections)

BEGIN;

-- ---------------------------------------------------------------------------
-- brevo_webhook_events: raw webhook payload store for async processing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brevo_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  connection_id UUID REFERENCES integration_connections(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brevo_webhook_events_processed
  ON brevo_webhook_events(processed, received_at ASC)
  WHERE processed = false;

CREATE INDEX IF NOT EXISTS idx_brevo_webhook_events_tenant
  ON brevo_webhook_events(tenant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_brevo_webhook_events_external_id
  ON brevo_webhook_events(external_event_id);

-- ---------------------------------------------------------------------------
-- Extend activities CHECK constraint to include webhook-driven event types
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  current_check TEXT;
  new_types TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_check
  FROM pg_constraint
  WHERE conname = 'activities_type_check'
    AND conrelid = 'activities'::regclass;

  IF current_check IS NOT NULL THEN
    -- Drop the existing constraint to recreate it with new types
    ALTER TABLE activities DROP CONSTRAINT activities_type_check;

    new_types := current_check ||
      ' OR ''email_opened''::text = ANY (ARRAY[''email_opened''::text])' ||
      ' OR ''email_clicked''::text = ANY (ARRAY[''email_clicked''::text])' ||
      ' OR ''email_bounced''::text = ANY (ARRAY[''email_bounced''::text])' ||
      ' OR ''email_delivered''::text = ANY (ARRAY[''email_delivered''::text])' ||
      ' OR ''email_failed''::text = ANY (ARRAY[''email_failed''::text])' ||
      ' OR ''email_unsubscribed''::text = ANY (ARRAY[''email_unsubscribed''::text])';

    -- Since we can't easily combine, just use a simple CHECK with all values
    ALTER TABLE activities ADD CONSTRAINT activities_type_check CHECK (
      type IN (
        'created', 'updated', 'deleted',
        'note_added', 'task_created', 'task_completed', 'deal_stage_changed',
        'email_sent', 'call_made', 'meeting_scheduled',
        'email_opened', 'email_clicked', 'email_bounced',
        'email_delivered', 'email_failed', 'email_unsubscribed'
      )
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Add email_opt_out and email_valid columns to contacts (additive)
-- ---------------------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_opt_out BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_valid BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN contacts.email_opt_out IS 'Platform-wide email opt-out flag (unsubscribe / hard bounce / spam). Once true, all email send paths must check this before sending.';
COMMENT ON COLUMN contacts.email_valid IS 'Set to false after a hard bounce or invalid-email event. Distinct from opt-out (user preference vs deliverability).';

-- ---------------------------------------------------------------------------
-- RLS for brevo_webhook_events (service-role only, no user-facing access)
-- ---------------------------------------------------------------------------
ALTER TABLE brevo_webhook_events ENABLE ROW LEVEL SECURITY;

COMMIT;
