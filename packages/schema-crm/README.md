# @tindevelopers/schema-crm

Zod schemas, row/insert/update types, manifest, and ground-truth migrations for
the **seven existing CRM tables** — nothing speculative.

## Tables

| Table | Columns | Source migrations |
|---|---|---|
| `contacts` | 30 effective | 20251208000000 + 4 ALTERs |
| `contact_channels` | 10 | 20260615000001 |
| `campaigns` | 32 effective (incl. `deleted_at`, `timezone`, provider columns, multi-turn guards, `campaign_type` incl. `email`) | 20260210000000 + 4 ALTERs |
| `campaign_recipients` | 31 effective | 20260210000000 + 4 ALTERs |
| `contact_sync_log` | 8 | 20260320100000 |
| `sync_state` | 11 | 20260603120000 |
| `field_mappings` | 10 | 20260603120000 |

Drift columns `lifecycle_stage`, `score`, and `do_not_contact` do **not** exist
and are rejected by the strict row schemas. `contacts.ghl_contact_id` /
`ghl_last_synced_at` exist in the DDL but are not yet present on the hosted DB,
so they are modeled as optional on rows (real hosted rows parse).

## Subpath exports

| Subpath | Exports |
|---|---|
| `.` | all Zod schemas + row/insert/update types + enums |
| `./manifest` | `crmManifest` — migrations dir + the seven-table map |

## Usage

```ts
import { contactRowSchema, type ContactRow } from "@tindevelopers/schema-crm";
import { crmManifest } from "@tindevelopers/schema-crm/manifest";

const contact: ContactRow = contactRowSchema.parse(rowFromPostgrest);
console.log(Object.keys(crmManifest.tables)); // the seven existing tables
```

## Migrations

`migrations/` carries the verbatim ground-truth DDL (read-only reference record
of what the schemas encode); they are applied by the consumer's tooling.
