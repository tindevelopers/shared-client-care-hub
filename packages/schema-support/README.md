# @tindevelopers/schema-support

Zod schemas, row/insert/update types, manifest, and ground-truth migrations
for the **five existing support-ticketing tables** — nothing speculative.

## Tables

| Table | Columns | Source migrations |
|---|---|---|
| `support_categories` | 7 | 20251221000000 |
| `support_tickets` | 17 effective | 20251221000000 + 1 ALTER shipped (see note below) |
| `support_ticket_threads` | 8 | 20251221000000 |
| `support_ticket_attachments` | 9 | 20251221000000 |
| `support_ticket_history` | 8 | 20251221000000 |

Per ADR-0002 (shell-base-admin `docs/ADR-0002-schema-ownership.md`): a
package's manifest must declare every table its own migrations create.
`support_ticket_history` (the ticket audit log, written by the
`track_ticket_history()` trigger) is created by this package's own base
migration, so it is claimed here as a fifth owned table, not left out.

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
| `./manifest` | `supportManifest` — migrations dir + the five-table map |

## Usage

```ts
import { supportTicketRowSchema, type SupportTicketRow } from "@tindevelopers/schema-support";
import { supportManifest } from "@tindevelopers/schema-support/manifest";

const ticket: SupportTicketRow = supportTicketRowSchema.parse(rowFromPostgrest);
console.log(Object.keys(supportManifest.tables)); // the five support tables
```

## Migrations

`migrations/` carries the verbatim ground-truth DDL (read-only reference
record of what the schemas encode); they are applied by the consumer's
tooling.
