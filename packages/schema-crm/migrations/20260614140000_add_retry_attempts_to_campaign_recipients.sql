-- Add retry_attempts column to campaign_recipients for timeout retry tracking
-- Supports ConversationTimeoutProcessor retry exhaustion logic
-- Depends on: conversation_tables (20260614120000) for campaign_recipients conversation_status

BEGIN;

-- ============================================================================
-- Campaign recipient extension: retry_attempts for timeout follow-up tracking
-- ============================================================================
ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS retry_attempts INTEGER NOT NULL DEFAULT 0;

COMMIT;
