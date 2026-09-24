# @tindevelopers/schema-support

Zod schemas, row/insert/update types, manifest, and ground-truth migrations
for the **four existing support-ticketing tables** — nothing speculative.

## Tables

| Table | Columns | Source migrations |
|---|---|---|
| `support_categories` | 7 | 20251221000000 |
| `support_tickets` | 17 effective | 20251221000000 + 2 ALTERs |
| `support_ticket_threads` | 8 | 20251221000000 |
| `support_ticket_attachments` | 9 | 20251221000000 |

Drift note: `is_active` (`support_categories`) and `is_internal`
(`support_ticket_threads`) are `BOOLEAN DEFAULT ...` with no `NOT NULL` in the
DDL, so both are modeled nullable even though the existing
`core-kernel/support/types.ts` types them as non-null. `support_tickets.external_refs`
and `sync_state` (added by `20260905000000_create_sync_bindings.sql`) are not
in that types file at all — the SQL wins and both are modeled as `NOT NULL`
JSONB columns.

`support_ticket_history` (audit log) is created by the same base migration
but is not one of the four tables this package owns; it is left untouched in
the copied migration file per the additive-only, byte-identical convention
(ADR-0002).

## Subpath exports

| Subpath | Exports |
|---|---|
| `.` | all Zod schemas + row/insert/update types + enums |
| `./manifest` | `supportManifest` — migrations dir + the four-table map |

## Usage

```ts
import { supportTicketRowSchema, type SupportTicketRow } from "@tindevelopers/schema-support";
import { supportManifest } from "@tindevelopers/schema-support/manifest";

const ticket: SupportTicketRow = supportTicketRowSchema.parse(rowFromPostgrest);
console.log(Object.keys(supportManifest.tables)); // the four support tables
```

## Migrations

`migrations/` carries the verbatim ground-truth DDL (read-only reference
record of what the schemas encode); they are applied by the consumer's
tooling.
