# @tindevelopers/domain-campaigns

Campaigns domain: the tenant-scoped campaign store, the calling-window
scheduler, and the provider-agnostic marketing campaign service. Injection-only
— every API receives a `SupabaseClient`; the package never constructs one,
never imports core-kernel's `database/admin-client`, never reads the
service-role key from the environment, and never imports another domain
package (R5: audience access happens through an injected callback).

## Public surface (`@tindevelopers/domain-campaigns`)

| Export | Contents |
|---|---|
| `createCampaignStore(client, tenantId)` | `list` / `get` / `create` / `update` / `softDelete` / `getStats` / `listRecipients` / `getRecipientTimezoneStats` |
| `nextAllowedStartUtc(params)` | Calling-window scheduling — moved byte-identical from `apps/app/src/core/campaigns/scheduling.ts` |
| `createMarketingCampaignService(deps)` | `createMarketingCampaign`, `sendCampaignNow`, `getCampaignReport`, `triggerLifecycleAutomation` |
| types | `CampaignStats` (exact 10-field shape), `CampaignRecipientProjection` (exact 13-column projection), `CampaignStore`, `SegmentDefinition`, `MaterializedAudience`, service deps/result types |

## Store parity

Every store method mirrors the query shape of
`apps/app/app/actions/campaigns/campaigns.ts` payload for payload:

- `list` — `select("*")`, `deleted_at IS NULL`, `created_at DESC` (getCampaigns)
- `get` — full row, `PGRST116 → null` for missing/soft-deleted ids (getCampaign)
- `create` — the exact createCampaign row defaults; resolves with the new id
- `update` — caller's partial patch; `updated_at` never sent (the
  `update_campaigns_updated_at` DB trigger owns it)
- `softDelete` — sets `deleted_at` + `status: "cancelled"` on live rows only;
  the row physically remains (deleteCampaign)
- `getStats` — tallies `campaign_recipients.status` into the exact
  `CampaignStats` fields; unknown statuses increment `total` only (getCampaignStats)
- `listRecipients` — the exact 13-column projection, `created_at DESC`,
  optional status filter, `range(offset, offset + limit - 1)` with defaults
  limit 100 / offset 0 (getCampaignRecipients)
- `getRecipientTimezoneStats` — `Record<timezone, count>` with null/empty
  timezones bucketed as `"Unknown"` (getRecipientTimezoneStats)

Server actions stay as authorization/audit adapters; only the DB access moves
into the store.

## Marketing campaign service

`createMarketingCampaignService(deps)` is the promotion of
`apps/app/src/core/campaigns/campaign-service.ts` with every external effect
injected:

```ts
const service = createMarketingCampaignService({
  campaigns: createCampaignStore(client, tenantId), // or a system-tier store
  resolveAudience: (tenantId, segment, listName) => materializeSegment(...),
  getProvider: () => getMarketingProvider("brevo"),
  emit: (type, envelope) => emit(type as never, envelope as never),
});
```

- **R1** — the service talks to the `MarketingAutomationProvider` port only;
  no vendor SDK is ever imported here.
- **R5** — audience materialization is the injected `resolveAudience` callback;
  the segment materializer living in the contacts domain is never imported.
- Provider/credential lifecycle (integration connection resolution, provider
  initialization) belongs to the host composition via `getProvider`.
- Idempotent re-send (`sendCampaignNow` on a sent/completed campaign is a
  no-op), opt-out filtering upstream in the resolver (only `optedOutCount` is
  surfaced), zero-audience warn-and-continue, and the `campaign:<id>:created`
  idempotency key (on the historical `"campaign.opted_in"` event name) are
  pinned by characterization tests running purely against stub deps.

## Not included (deferred to Phase 3 commerce)

`automation-settings` and `call-context-speech` stay app-local; they are not
part of this package's exports or its tarball.

## No production callers

Publishing this package adds no callers. Wiring konnect's actions to the store
and deleting the app-local copies happens in the consumer repo's writer
cutover, as one commit with the import repoints.
