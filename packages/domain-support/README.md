# @tindevelopers/domain-support

Support domain: ticket policy, handoff routing, conversation-to-ticket
linking, graduation (first-party-first specialist-desk sync), notification
decisions with escaped templates, and the injected data-access stores for the
five `support_*` tables (typed from `@tindevelopers/schema-support`).

Injection-only (R2): every store factory takes a `SupabaseClient` and a
`tenantId` and binds every query to that tenant; the package never
constructs a client, never imports core-kernel's `database/admin-client`,
never reads the service-role key from the environment, and never resolves
the acting user itself — `created_by`/`user_id`/`uploaded_by` are explicit
arguments the host resolves and injects.

## Public surface

| Export | Contents |
|---|---|
| `createSupportTicketStore(client, tenantId)` | `list` / `get` / `getByNumber` / `create` / `update` / `remove` / `stats` |
| `createSupportThreadStore(client, tenantId)` | `list` / `get` / `create` / `update` / `remove` |
| `createSupportAttachmentStore(client, tenantId)` | `list` / `get` / `create` / `remove` / `getDownloadUrl` (Supabase Storage, `support-tickets` bucket) |
| `createSupportCategoryStore(client, tenantId)` | `list` / `get` / `create` / `update` / `remove` (soft delete: `is_active = false`) |
| `createSupportStore(client, tenantId)` | Composes the four stores above into the `SupportStore` contract `createSupportService` depends on |
| `createSupportService(deps)` | Ticket policy, notifications, and desk-sync orchestration over an injected `SupportStore` |

`id`, `ticket_number` (DB trigger), `created_at`, and `updated_at` are always
DB-owned — no store ever synthesizes them.

The higher-level pieces (`ticket-policy`, `handoff`, `conversation-support`,
`graduation`, `notifications`) stay pure and dependency-injected as before;
`SupportNotificationSender` and `syncDeskBestEffort` are still host-provided
(e.g. with `@tindevelopers/core-kernel/email` and the graduation core wired
through `createBindingProviderResolver`).

Required env: none.
