# @tindevelopers/domain-pipeline

CRM pipeline domain: injected data-access stores for the six pipeline tables
(typed from `@tindevelopers/schema-crm`) — companies, deal stages, deals,
tasks, notes, and activities.

Injection-only (R2): every store factory takes a `SupabaseClient` and a
`tenantId` and binds every query to that tenant; the package never
constructs a client, never imports core-kernel's `database/admin-client`,
never reads the service-role key from the environment, and never resolves
the acting user itself — `created_by`/`assigned_to` are explicit optional
arguments the host resolves and injects.

## Public surface

| Export | Contents |
|---|---|
| `createCompanyStore(client, tenantId)` | `list` / `get` / `create` / `update` / `remove` / `bulkRemove` |
| `createDealStageStore(client, tenantId)` | `list` / `get` / `create` / `update` / `remove` / `seedDefaults` |
| `createDealStore(client, tenantId)` | `list` / `listByStage` / `get` / `create` / `update` / `remove` |
| `createTaskStore(client, tenantId)` | `list` / `get` / `create` / `update` / `remove` / `bulkRemove` / `bulkComplete` |
| `createNoteStore(client, tenantId)` | `list` / `create` / `update` / `remove` |
| `createActivityStore(client, tenantId)` | `list` / `create` / `logEntityCreated` / `logEntityUpdated` / `logEntityDeleted` / `logNoteAdded` |
| `createPipelineStore(client, tenantId)` | Composes the six stores above into one entry point, keyed `companies` / `dealStages` / `deals` / `tasks` / `notes` / `activities` |

`id`, `created_at`, and `updated_at` (where the table has one) are always
DB-owned — no store ever synthesizes them.

## Cross-tenant reference verification

A host-supplied foreign key only proves the referenced row exists
somewhere — not that it belongs to the caller's tenant. Before writing one
of these tables' rows, the owning store verifies every reference into a
table it doesn't itself scope by tenant here:

- `createDealStore` verifies `company_id`, `contact_id`, and `stage_id` on
  `create`, and re-verifies whichever of those three a patch changes on
  `update`.
- `createTaskStore` and `createNoteStore` verify `company_id`, `contact_id`,
  and `deal_id` the same way on `create`; `createTaskStore.update` also
  re-verifies a changed reference.
- `createActivityStore` does not re-verify its own
  `contact_id`/`company_id`/`deal_id`/`task_id`/`note_id` columns: activities
  are an append-only audit trail with no `has_reference` CHECK, and its
  `log*` helpers are called internally with ids the calling store already
  verified moments earlier.

A failed check throws `"<Entity> not found"` (e.g. `"Company not found"`)
instead of surfacing the database's raw foreign-key or CHECK violation.

## Parent-reference CHECK constraints (application-layer enforcement)

`tasks_has_reference` requires **exactly one** of
`contact_id`/`company_id`/`deal_id`; `notes_has_reference` requires **at
least one**. Neither is represented in `@tindevelopers/schema-crm`'s Zod
schemas (a phase-4a gap), so `createTaskStore().create` and
`createNoteStore().create` enforce them before insert, throwing a clear
`Error` instead of letting the CHECK constraint reject with a raw
constraint-violation message. `update()` relies on the DB CHECK for the same
invariant (a patch is partial; only the merged row proves the invariant,
which the CHECK already computes for free).

## Deal stages

Konnect hard-codes six default stages in application code
(`createDefaultDealStages()`) with no per-tenant override.
`createDealStageStore` instead exposes full CRUD, so a tenant CAN customize
its stages, plus a separate `seedDefaults()` that inserts the same six
names/colors (`Lead`, `Qualified`, `Proposal`, `Negotiation`, `Won`, `Lost`)
only for a tenant that has none yet — a one-time bootstrap, not the only
path going forward.

## Activity logging

`createCompanyStore`, `createDealStore`, `createTaskStore`, and
`createNoteStore` each log a `created`/`updated`/`deleted`/`note_added`
activity after their own write, via an internal `createActivityStore`
instance — the same side effect Konnect's `companies.ts`/`deals.ts`/
`tasks.ts`/`notes.ts` produce inline. Logging failures are swallowed
(`console.error`), matching Konnect's `activities.ts` verbatim: an activity
insert failing must never fail the caller's write. `note-store`'s
`update`/`remove` and `task-store`'s `update` log nothing, matching
Konnect's `notes.ts`/`tasks.ts`, which don't call the logging helpers there
either.

Required env: none.
