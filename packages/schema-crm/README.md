# @tindevelopers/schema-crm

Zod schemas, row/insert/update types, manifest, and ground-truth migrations
for the CRM tables this package owns (ADR-0002, `shell-base-admin`) —
nothing speculative.

## Tables

| Table | Columns | Source migrations |
|---|---|---|
| `contacts` | 30 effective | 20251208000000 + 5 ALTERs |
| `contact_channels` | 10 | 20260615000001 |
| `contact_groups` | 10 | 20260210100000 + 2 ALTERs |
| `contact_group_members` | 5 | 20260210100000 + 1 ALTER |
| `contact_suppressions` | 10 | 20260919010000 + 1 ALTER |
| `campaigns` | 32 effective (incl. `deleted_at`, `timezone`, provider columns, multi-turn guards, `campaign_type` incl. `email`) | 20260210000000 + 4 ALTERs |
| `campaign_recipients` | 31 effective | 20260210000000 + 4 ALTERs |
| `campaign_lists` | 11 | 20260210000000 |
| `campaign_events` | 7 | 20260210000000 |
| `contact_sync_log` | 8 | 20260320100000 |
| `sync_state` | 11 | 20260603120000 |
| `field_mappings` | 10 | 20260603120000 |
| `processed_external_events` | 4 | 20260603120000 |
| `conversation_turns` | see `sync.ts` / conversations module migrations | 20260614120000 + 1 ALTER |
| `companies` | 17 | 20251208000000 + 20251208000001 (RLS) |
| `deal_stages` | 7 | 20251208000000 + 20251208000001 (RLS) |
| `deals` | 17 | 20251208000000 + 20251208000001 (RLS) |
| `tasks` | 15 | 20251208000000 + 20251208000001 (RLS) |
| `notes` | 12 | 20251208000000 + 20251208000001 (RLS) |
| `activities` | 12 (`type` CHECK extended by 20260614230000 to 16 values) | 20251208000000 + 20251208000001 (RLS) + 20260614230000 |
| `brevo_webhook_events` | 12 | 20260614230000 |
| `custom_field_definitions` | 11 | 20260603100000 |

Drift columns `lifecycle_stage`, `score`, and `do_not_contact` do **not** exist
and are rejected by the strict row schemas. `contacts.ghl_contact_id` /
`ghl_last_synced_at` exist in the DDL but are not yet present on the hosted DB,
so they are modeled as optional on rows (real hosted rows parse).

`companies`, `deal_stages`, `deals`, `tasks`, `notes`, and `activities` are
created by this package's own `20251208000000_create_crm_tables.sql` (same
migration as `contacts`); `brevo_webhook_events`, `campaign_events`, and
`campaign_lists` are created by this package's own migrations too. All nine
were previously undeclared in the manifest — closed the same way ADR-0002
closed the `conversation_turns` / `processed_external_events` gap: the tables
already existed, only the manifest was missing them. `custom_field_definitions`
is the same gap again: created by its own `20260603100000` migration, used by
`apps/ops`, but never declared by this package until now.

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
