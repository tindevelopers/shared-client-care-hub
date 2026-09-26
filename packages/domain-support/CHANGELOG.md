# @tindevelopers/domain-support

## Unreleased

**BREAKING (next version must be 5.0.0 or higher — 3.0.0 and 4.0.0 are
already published and immutable).**

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
  contract are unchanged. A system operator with no tenant now throws
  instead of resolving to a fallback tenant.

This release also moves the package's source from `shell-base-admin`
(source commit `6aff243`, published as `@tindevelopers/domain-support`
4.0.0) into this hub. The source is otherwise unchanged — same public API,
same peer dependencies — only the tenant-helper change above is new.
**The `exports` map's `"./*"` wildcard is replaced by one explicit entry
per module** (all 19 modules plus `.`). Every subpath the wildcard resolved
still resolves to the same `dist/<name>.js`. This hub's
`scripts/validate-packages.mjs` rejects wildcard subpaths, so the published
shape could not be copied verbatim. A new top-level module now needs its
own `exports` entry.

The build target moves from ES2017 (shell-base-admin) to ES2022 (this hub's
`tsconfig.base.json`, shared by every hub package). Emitted `.d.ts` files
are byte-identical to 4.0.0 apart from `tenant-helper.d.ts`. The `.js`
files differ only in syntax lowering: `??` is emitted natively, and class
fields are declared.

The `shell-base-admin` copy is retired per that repo's
`PUBLISH.md` §8 only once this hub publishes its first release of this
package.

## 4.0.0

### Major Changes

- 89325be: The service enforces the support-agent rule.

  Breaking change: `SupportServiceDeps` requires `actor: { id: string; isAgent: boolean }`. For a non-agent (`isAgent: false`) the service:

  - hides internal threads (`listThreads`) and attachments on internal threads (`listAttachments`);
  - rejects `appendThread` with `is_internal: true`;
  - rejects `updateTicket`, `escalateTicket`, `resolveTicket`, `returnEscalation`, `withdrawEscalation`, `mergeTickets`, `saveCategory`, `deleteCategory` and `saveGroup` with the new `SupportForbiddenError` (carrying `operation`), before touching the store.

  Requester operations (`listTickets`, `getTicket`, `createTicket`, public replies, `listCategories`, `listGroups`, `listLinks`, `getTicketClocks`) are unchanged. Also exported: `SupportActor`, `requireAgent`.

  Migration: pass `actor` to `createSupportService`, with `isAgent` from the `support.agent` permission (`current_user_has_permission('support.agent')` from `@tindevelopers/schema-identity` 1.1.0); map `SupportForbiddenError` to a "not allowed" response.

  Design: shell-base-admin `docs/specs/2026-09-25-support-agent-permission-design.md` §3.3.

## 3.0.0

### Major Changes

- 2d98d8f: Owner-scoped support with a multi-level escalation chain.

  Breaking changes:

  - The package owns its support model (`SupportTicket`, `SupportTicketThread`, `SupportTicketAttachment`, `SupportCategory`, `TicketStatus`, `TicketPriority`, `CreateTicketInput`, `UpdateTicketInput`) instead of re-exporting `@tindevelopers/core-kernel/support`. Every row carries `owner_scope` + `tenant_id` / `partner_id`: a ticket is owned by exactly one tenant, partner or the platform.
  - `TicketStatus` adds `waiting_on_customer` and `waiting_on_upstream`. `escalated_to_platform_admin_at` is removed; escalation is a linked upstream ticket.
  - `SupportStore` is owner-scoped. `saveTicket(ticket, actorId)` takes the acting user, and the store adds `listGroups`, `saveGroup`, `listLinks` and `listStatusEvents`.
  - `SupportServiceDeps` requires `ownerChain` (`SupportOwnerChain`) and `escalations` (`SupportEscalationGateway`, the only cross-owner writer). `createTicket` and `updateTicket` take `actorId`.
  - Notifications: `SupportNotification.tenantId` is replaced by `owner`; recipient `platform_admins` is replaced by `owner_queue`; `buildTicketEscalatedNotifications(upstream, fromOwnerLabel)` targets the upstream queue.
  - `updateTicket` enforces the status rules and refuses to resolve or close a ticket that escalations are waiting on.

  Added:

  - `escalateTicket`, `resolveTicket`, `returnEscalation`, `withdrawEscalation`, `mergeTickets` on the service, with pure planners `selectEscalationTarget`, `buildUpstreamTicket` (privacy-filtered copy: no requester identity, replies, notes or attachments unless chosen), `planResolution`, `planReturn`, `planWithdraw`, `planMerge`.
  - Support groups for tiers inside an owner (`group_id`).
  - `computeTicketClocks` / `getTicketClocks`: a customer clock that stops only when resolved or closed, and an owner clock that also pauses while waiting on the customer or upstream.
  - `ticket_returned` and `upstream_resolved` notifications, sent only to agents.
  - Support access grants (`access.ts`): `SupportAccessGrant`, `SupportAccessEvent`, `accessGrantState`, `validateAccessRequest` and the access limits. Staff above an owner read its tickets only through a consented, time-boxed, read-only, logged grant; break-glass is platform-only, 1 hour, and alerts the owner.

  Design: `konnect-caas-base` `docs/superpowers/specs/2026-09-24-support-escalation-chain-design.md`.

## 2.0.1

### Patch Changes

- Declare `@tindevelopers/core-kernel` `^2.0.0` (peer and dev) instead of `^1.0.0`, so the package's manifest matches the core-kernel line it is built and tested against. The published 2.0.0 declared `^1.0.0`. The compiled output is byte-identical to 2.0.0; only the manifest changes. Also records the release as the first one made from hub `main` since the 2.0.0 rewrite was published from the unmerged thin-support-domain branch.
