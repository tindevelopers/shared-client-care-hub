# @tindevelopers/domain-support

Portable support domain: owner-scoped tickets (tenant, partner or platform),
support groups for tiers inside an owner, a multi-level escalation chain
(linked upstream tickets, send-back, withdrawal, merge with fan-out),
customer and owner clocks, ticket policy, handoff routing,
conversation-to-ticket linking, graduation (first-party-first
specialist-desk sync), and notification decisions with escaped templates.

The package is pure — no database client, no `"use server"`, no vendor SDK.
The host app implements:

- `SupportStore` — storage for ONE owner, never another owner's rows
- `SupportNotificationSender` — e.g. with `@tindevelopers/core-kernel/email`
- `SupportOwnerChain` — an owner's parent (subtenant → tenant → partner → platform)
- `SupportEscalationGateway` — the only cross-owner writer; authorizes the
  actor and applies each escalation plan in one transaction
- `syncDeskBestEffort` — e.g. with the graduation core wired through
  `createBindingProviderResolver`
- `actor` — `{ id, isAgent }` for the caller; `isAgent` means the caller
  holds the `support.agent` permission (e.g. from
  `current_user_has_permission('support.agent')`)

then composes everything with `createSupportService(deps)`.

The service enforces the support-agent rule itself. For a non-agent it
hides internal threads and their attachments, rejects internal notes, and
throws `SupportForbiddenError` on ticket state changes (update, escalate,
resolve, send back, withdraw, merge) and on category and group writes.
Requesters keep listing, reading and creating tickets and replying publicly.

Nothing identifying the requester, no reply, no internal note and no
attachment crosses an owner boundary unless the escalating agent chooses it.

Staff above an owner (its partner, or the platform) read that owner's
tickets only through a support access grant (`access.ts`): consented by the
owner's admins, time-boxed (1 to 168 hours), read-only, and logged on every
read. Break-glass is platform-only, lasts 1 hour and alerts the owner. The
host's database enforces the grant; the package supplies the types, state
and limits.

## Tenant resolution is fail-closed

`resolveSupportTenantId(context)` acts only in the actor's own resolved
tenant (`context.currentTenantId`); with none, it throws — it never falls
back to picking some other tenant. There is no platform-operator branch:
platform staff reach a customer tenant through a support session
(impersonation), which resolves a normal `currentTenantId` like any other
actor, so the domain needs no special case for it.

Required env: none.
