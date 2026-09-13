# @tindevelopers/domain-contacts

Owns the canonical `contacts` aggregate (spec rule R4): tenant-tier store,
system-tier store, suppression + CRM-sync event subscribers, and the campaign
segment materializer. Injection-only — every API receives a `SupabaseClient`;
the package never constructs one and never imports core-kernel's
`database/admin-client`.

## Public surface

| Entry | Contents |
|---|---|
| `@tindevelopers/domain-contacts` | `createContactsStore`, `createSystemContactsStore`, `materializeSegment` (+ `SegmentDefinition`, `MaterializedAudience`), domain errors (`DuplicateEmailError`, `ContactNotFoundError`, `TenantIdRequiredError`, `LifecycleStageUnsupportedError`), types |
| `@tindevelopers/domain-contacts/suppression` | `registerSuppressionSubscribers({ client })` / `unregisterSuppressionSubscribers()` — server-only (`contact.unsubscribed`, `message.bounced`) |
| `@tindevelopers/domain-contacts/crm-sync` | `registerCrmSyncSubscribers({ client })` / `unregisterCrmSyncSubscribers()` — server-only; the subscription handlers route to the internal `syncContactFromEvent` with the injected client |

The subscriber modules are **server-only** (`server-only` is a declared
dependency and the guard survives in the shipped dist) and are deliberately
absent from the root barrel so a client-context import can never pull them in.
Both registration functions take the host app's service-role client — domains
never construct clients.

## Delete-cascade blast radius (read before calling `remove` / `bulkRemove`)

`remove(id)` and `bulkRemove(ids)` are **tenant-scoped hard deletes** of
`contacts` rows. Postgres FKs cascade that delete to every dependent row:

- `conversations` (ON DELETE CASCADE)
- `messages` (ON DELETE CASCADE)
- `contact_channels` (ON DELETE CASCADE)
- `tasks` (ON DELETE CASCADE)
- `notes` (ON DELETE CASCADE)
- `activities` (ON DELETE CASCADE)
- `contact_group_members` (ON DELETE CASCADE)
- `conversation_message_queue` (ON DELETE CASCADE)

Referencing rows in `campaigns`, `deals`, `orders`, and commerce attribution
links only SET NULL their `contact_id`/`primary_contact_id` columns (the rows
survive with a null reference). This blast radius is the pre-existing hosted
schema behavior and is preserved as-is — documented, not changed.

## Segment materializer (drift fix #1)

`materializeSegment(tenantId, segment, listName, { client })` resolves a
`SegmentDefinition` (`tags`, `contactGroupId`; `lifecycleStage` unsupported)
against the hosted schema:

- the `contacts` SELECT never names `lifecycle_stage` or `score` (neither
  column exists hosted — Postgres 42703);
- a `lifecycleStage` filter throws `LifecycleStageUnsupportedError` **before
  any DB call**;
- `contactGroupId` resolves membership through `contact_group_members`
  (`contacts` has no `contact_group_id` column);
- contacts with `email_opt_out = true` or `email_valid = false` are excluded;
- zero eligible contacts returns the non-throwing shape
  `{ segmentCount, optedOutCount, materializedCount: 0, listId: 0, emails: [] }`
  (consumed by campaign-service's warn-and-continue path).
