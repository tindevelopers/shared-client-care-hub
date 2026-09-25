# @tindevelopers/schema-support

Zod schemas, row/insert/update types, manifest, and ground-truth migrations
for the **nine existing support-ticketing tables** — nothing speculative.

## Tables

| Table | Columns | Source migrations |
|---|---|---|
| `support_categories` | 9 | 20251221000000 + 20260924100000 |
| `support_tickets` | 19 effective | 20251221000000 + 20260223000000 + 20260924100000 + 20260924110000 |
| `support_ticket_threads` | 10 | 20251221000000 + 20260924100000 + 20260924110000 |
| `support_ticket_attachments` | 12 | 20251221000000 + 20260924100000 + 20260925130000 |
| `support_ticket_history` | 10 | 20251221000000 + 20260924100000 |
| `support_groups` | 8 | 20260924100000 + 20260925130000 |
| `support_ticket_links` | 12 | 20260924100000 + 20260924110000 |
| `support_access_grants` | 19 | 20260924120000 |
| `support_access_events` | 6 | 20260924120000 |

Per ADR-0002 (shell-base-admin `docs/ADR-0002-schema-ownership.md`): a
package's manifest must declare every table its own migrations create.
`support_ticket_history` (the ticket audit log, written by the
`track_ticket_history()` trigger) is created by this package's own base
migration, so it is claimed here alongside the others, not left out.
`support_groups`, `support_ticket_links`, `support_access_grants`, and
`support_access_events` were added by Konnect's owner-scoped Support
Escalation Chain (2026-09-24) and are adopted here for the same reason.

Every table above carries `owner_scope` (`'tenant' | 'partner' | 'platform'`,
except `support_access_grants`, which is narrower — see its own doc comment)
plus a nullable `tenant_id`/`partner_id` pair, added by
`20260924100000_support_owner_escalation.sql`.

### Retired: the partner ticket queue

`partner_support_tickets`/`partner_support_ticket_replies` (a separate,
actor-scoped pair keyed by `partner_id`, added by `20260913130000`) were
**dropped** by `20260924100000_support_owner_escalation.sql` — "no production
data of substance, confirmed 2026-09-24" per that migration's header.
Partner-owned tickets now live in `support_tickets` with `owner_scope =
'partner'`. `retiredTables` (exported from `./manifest`) records the
create/drop migration pair for provenance;
`@tindevelopers/domain-support`'s `createCounterpartyTicketStore`, the store
built on the two retired tables, is removed in the same release.

Drift note: `is_active` (`support_categories`) and `is_internal`
(`support_ticket_threads`) are `BOOLEAN DEFAULT ...` with no `NOT NULL` in the
DDL, so both are modeled nullable even though the existing
`core-kernel/support/types.ts` types them as non-null.

## Migrations — a column this package does NOT ship the migration for

`support_tickets.external_refs` and `support_tickets.sync_state` are real,
current DB ground truth (both `NOT NULL` JSONB, per `supportTicketRowSchema`)
and are not in `core-kernel/support/types.ts` at all — the SQL wins there.
Historically they were added by konnect's
`20260905000000_create_sync_bindings.sql`, which is **not shipped in this
package's `migrations/`**: that file's primary job is creating
`sync_bindings`, `sync_runs`, `sync_conflicts`, and `sync_dead_letters` — sync
engine tables this package does not own. Shipping it here would make
schema-support a second creator of those tables, which ADR-0002 forbids.
Per the ADR, that migration history stays in place at its original,
unmodified location; the sync engine's own owning package is responsible for
shipping it. This mirrors how `schema-crm` handles migrations shared with
other domains: it never copies a file whose only reason to exist is another
domain's tables (e.g. RLS-only migrations), it only ships files that define
DDL for a table it owns.

## Subpath exports

| Subpath | Exports |
|---|---|
| `.` | all Zod schemas + row/insert/update types + enums |
| `./manifest` | `supportManifest` — migrations dir + the nine-table map, plus `retiredTables` |

## Usage

```ts
import { supportTicketRowSchema, type SupportTicketRow } from "@tindevelopers/schema-support";
import { supportManifest } from "@tindevelopers/schema-support/manifest";

const ticket: SupportTicketRow = supportTicketRowSchema.parse(rowFromPostgrest);
console.log(Object.keys(supportManifest.tables)); // the nine support tables
```

## Migrations

`migrations/` carries the verbatim ground-truth DDL (read-only reference
record of what the schemas encode); they are applied by the consumer's
tooling. In adoption order:

- `20251221000000_create_support_tickets_schema.sql`
- `20260223000000_support_tickets_error_escalation.sql`
- `20260913130000_create_partner_support_tickets.sql` — kept as historical
  ground truth even though the tables it creates are retired (see
  `retiredTables`); Konnect main has already applied it.
- `20260924100000_support_owner_escalation.sql` — owner columns, `support_groups`,
  `support_ticket_links`, and the partner-queue drop.
- `20260924110000_support_escalation_gateway.sql` — the SECURITY DEFINER
  escalation gateway (no table DDL of its own).
- `20260924120000_support_access_grants.sql` — `support_access_grants`/`support_access_events`.
- `20260925130000_support_agent_permission.sql` — `support.agent` permission gate.

Database-level RLS/function coverage for the escalation chain and access
grants lives in Konnect's own pgTAP suite, not in this package:
`supabase/tests/support_escalation.test.sql`,
`supabase/tests/support_escalation_gateway.test.sql`, and
`supabase/tests/support_access.test.sql`.
