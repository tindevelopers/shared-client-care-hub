-- Fix multi-turn SMS conversation: add 'received' delivery status + last_inbound_at
-- Bugs found during E2E smoke test (scripts/smoke-multiturn-sms.mjs):
--   1. inbound conversation turns need delivery_status 'received' but CHECK only allowed
--      ('pending', 'sent', 'delivered', 'failed', 'rejected')
--   2. campaign_recipients.last_inbound_at column referenced in executor but missing
--
-- To apply: paste this entire file into the Supabase SQL Editor at
-- https://supabase.com/dashboard/project/sfdhtsfvkticvqjqdvud/sql/new

BEGIN;

-- ============================================================================
-- Fix 1: Add 'received' to conversation_turns.delivery_status CHECK constraint
-- ============================================================================
ALTER TABLE conversation_turns
  DROP CONSTRAINT IF EXISTS conversation_turns_delivery_status_check;

ALTER TABLE conversation_turns
  ADD CONSTRAINT conversation_turns_delivery_status_check
    CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'failed', 'rejected', 'received'));

-- ============================================================================
-- Fix 2: Add last_inbound_at column to campaign_recipients
-- ============================================================================
ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

COMMIT;