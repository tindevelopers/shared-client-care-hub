# @tindevelopers/schema-support

## Unreleased

### Added

- **`partner_support_tickets`/`partner_support_ticket_replies`** schemas,
  row/insert/update types, and manifest entries — additive, non-breaking new
  surface. Ground truth:
  `20260913130000_create_partner_support_tickets.sql`, shipped verbatim in
  `migrations/`. These are a separate, actor-scoped pair keyed by
  `partner_id` (not `tenant_id`), distinct from the existing tenant-scoped
  `support_tickets`/`support_ticket_threads`. See `src/partner-tickets.ts`.
