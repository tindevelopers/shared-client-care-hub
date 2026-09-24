# @tindevelopers/domain-support

Portable support domain: ticket policy, handoff routing, conversation-to-ticket
linking, graduation (first-party-first specialist-desk sync), and notification
decisions with escaped templates.

The package is pure — no database client, no `"use server"`, no vendor SDK.
The host app implements the injected `SupportStore`, `SupportNotificationSender`
(e.g. with `@tindevelopers/core-kernel/email`), and `syncDeskBestEffort`
(e.g. with the graduation core wired through `createBindingProviderResolver`),
then composes everything with `createSupportService(deps)`.

Required env: none.
