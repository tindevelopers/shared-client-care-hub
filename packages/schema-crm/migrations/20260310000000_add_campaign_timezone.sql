-- Add timezone to campaign schedule so calling window is interpreted in that zone.
-- IANA time zone identifier (e.g. America/New_York). Enables future per-recipient
-- timezone evaluation when contact timezone is available.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';

COMMENT ON COLUMN campaigns.timezone IS 'IANA time zone for calling_window_start/end (e.g. America/New_York).';
