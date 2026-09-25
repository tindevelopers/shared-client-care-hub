# @tindevelopers/domain-support

## Unreleased

**BREAKING (next release must be a major, 3.0.0 proposed — owner confirms).**
This package now owns the support data layer instead of depending on
`@tindevelopers/core-kernel/support`; the following are breaking changes to
the public API a consumer must account for on upgrade:

- **`@tindevelopers/schema-support` adopts Konnect's owner-scoped support
  escalation chain** (ADR-0002 schema ownership; ground truth
  `20260924100000_support_owner_escalation.sql` and friends — see that
  package's changelog for the full column-level list). The rows this
  package's types derive from change shape as a result:
  - `SupportTicket`/`SupportCategory`/`SupportTicketThread`/
    `SupportTicketAttachment`'s `tenant_id` **widens from required to
    nullable** (`string | null`) — a partner- or platform-owned row has no
    tenant. `SupportNotification.tenantId` follows the same widening.
  - **`SupportTicketRow.escalated_to_platform_admin_at` is removed** (the
    column is dropped from `support_tickets`; platform escalation now goes
    through `owner_scope = 'platform'` and Konnect's escalation gateway
    functions, not this column). `SupportTicket` keeps the field as a
    domain-only, optional compatibility property so the existing
    escalation-notification path (`tickets.ts`/`notifications.ts`) keeps
    working unchanged; redesigning that path onto the owner-scope gateway is
    a later step, out of scope here.
  - **`createCounterpartyTicketStore` is removed** (see Removed, below) —
    the two tables it was built on are retired upstream.
  - The stores in this package (`createSupportTicketStore` and friends) are
    **not** redesigned to be owner-scope aware in this change; they still
    read/write `support_tickets` et al. exactly as before, scoped only by
    `tenantId`. Owner-scope-aware stores are a later step.
- **`SupportStore.saveTicket(ticket)` is removed**, replaced by
  `createTicket(input: CreateSupportTicketInput)` and
  `updateTicket(id, input: UpdateTicketInput)`. The old contract required
  the HOST to synthesize `id`/`ticket_number`/timestamps before every call;
  the new one lets the DB own them (the `set_support_ticket_number` trigger
  and column defaults) and takes `created_by` as an explicit argument
  instead. `SupportService.createTicket` has the same new input shape.
- **Domain types now come from `@tindevelopers/schema-support` row types**,
  not `@tindevelopers/core-kernel/support/types`: `SupportCategory`,
  `SupportTicket`, `SupportTicketThread`, `SupportTicketAttachment`. Two
  fields widen from non-null to nullable to match the real DDL (a
  documented pre-existing drift in schema-support): `SupportCategory.is_active`
  and `SupportTicketThread.is_internal` are now `boolean | null`.
- **New public API**: `createSupportTicketStore`, `createSupportThreadStore`,
  `createSupportAttachmentStore`, `createSupportCategoryStore`, and
  `createSupportStore` (all `(client: SupabaseClient, tenantId: string) => …`,
  the same injection-only shape as `domain-contacts`' `createContactsStore`).
- **`@tindevelopers/core-kernel` is no longer a dependency of this package**
  (peer or otherwise) — zero imports of `@tindevelopers/core-kernel/support`
  remain. `@tindevelopers/adapter-kit` moves from a peer dependency to a
  real one (it was always a runtime import in `graduation.ts`, not type-only).
  `@supabase/supabase-js` and `@tindevelopers/schema-support` (`workspace:^`)
  are added as real dependencies.
- **Attachment paths must sit inside the tenant's storage folder**
  (`<tenantId>/…`, optionally prefixed `support-tickets/`, no `..`
  segments). `createSupportAttachmentStore().create` rejects any other
  `file_path` before touching the database. (`remove`/`getDownloadUrl`'s
  handling of an existing out-of-folder path is covered below, under
  Fixed — they degrade gracefully rather than throwing.) The core-kernel
  version accepted any host-supplied path.
- **`SupportTicket`'s `support_code`, `support_ref`, and
  `escalated_to_platform_admin_at` move from optional to required-and-
  nullable** (`string | null`, always present), matching the
  `@tindevelopers/schema-support` row exactly now that `SupportTicket`
  extends it directly. `external_refs`/`sync_state` also newly appear on
  the type, as optional (`schema-support`'s `tickets.ts` doc comment
  explains why: the migration that creates those two columns is not
  shipped by that package).
- **`SupportTenantContext` drops `isSystemOperator`/`firstAvailableTenantId`,
  and `resolveSupportTenantId` no longer falls back to an arbitrary tenant
  for system operators.** The old fallback let a platform-operator caller
  with no tenant of their own act in "the first available tenant" — an
  arbitrary customer tenant. The new rule is fail-closed: act only in the
  actor's own resolved tenant, or throw. Platform staff reach a customer
  tenant through a support session (impersonation), which resolves a normal
  tenant scope like any other actor, so the domain needs no platform branch.
  The `"No tenants found"` (system-operator, no tenant) error message is
  removed entirely; the remaining `"No tenant found"` message and its prefix
  contract are unchanged.

### Removed

- **`createCounterpartyTicketStore(client, partnerId)`** (`./stores`),
  along with its types (`CounterpartyTicket`, `CounterpartyTicketReply`,
  `CounterpartyTicketStore`, etc.) — the store for Konnect's partner-facing
  ticket queue (`partner_support_tickets`/`partner_support_ticket_replies`).
  This package's Unreleased log previously listed adding this store; it is
  removed here, in the same Unreleased window, before ever shipping: those
  two tables are now retired upstream — "no production data of substance,
  confirmed 2026-09-24" per
  `20260924100000_support_owner_escalation.sql`'s header — so the store built
  on them is dropped rather than left pointing at dropped tables.
  Partner-owned tickets now live in `support_tickets` with `owner_scope =
  'partner'`; a store for that shape is a later step.

### Fixed

Found in post-merge review of the store port above; behavior changes a
consumer may notice:

- **Cross-tenant category/thread references.** `createSupportTicketStore().create`/
  `.update` now verify a supplied `category_id` belongs to the bound tenant
  before writing it, and `createSupportAttachmentStore().create` does the
  same for `thread_id` (throwing `"Category not found"` / `"Thread not
  found"` otherwise). A foreign key alone only proves the row exists
  somewhere; previously a cross-tenant id was accepted and readable back
  through `TICKET_SELECT`'s `category:support_categories(*)` join.
- **Empty-string optional fields.** `create()` on the ticket, attachment,
  and category stores again treats `''` as `null` for optional uuid/text
  fields (ticket `description`/`category_id`/`assigned_to`/`support_code`/
  `support_ref`, attachment `thread_id`, category `description`), matching
  the core-kernel original. The initial port used `?? null`, which let an
  empty string reach a uuid column and fail at the database.
- **Internal-note attachments leaking.** `createSupportStore(...).listAttachments`
  now excludes attachments on internal (`is_internal`) threads, matching
  `listThreads`'s existing behavior. The lower-level
  `createSupportAttachmentStore().list` is unchanged (agent-side callers
  may still need everything).
- **`NULL` `is_internal` hidden from thread lists.** `createSupportThreadStore().list`
  now treats a `NULL` `is_internal` the same as `false` (not internal); it
  previously hid such rows entirely because the column is nullable and the
  filter used `.eq("is_internal", false)`.
- **Legacy attachment paths.** `createSupportAttachmentStore().remove`/
  `.getDownloadUrl` no longer throw for a stored `file_path` outside the
  tenant's folder. `remove` still deletes the tenant-scoped row (skipping
  only the storage delete, with a logged warning); `getDownloadUrl` returns
  `null`. This unblocks legacy rows written before paths were confined to
  the tenant's folder. `create` is unchanged and still rejects an
  out-of-folder path outright.

## 2.0.1

### Patch Changes

- Declare `@tindevelopers/core-kernel` `^2.0.0` (peer and dev) instead of `^1.0.0`, so the package's manifest matches the core-kernel line it is built and tested against. The published 2.0.0 declared `^1.0.0`. The compiled output is byte-identical to 2.0.0; only the manifest changes. Also records the release as the first one made from hub `main` since the 2.0.0 rewrite was published from the unmerged thin-support-domain branch.
