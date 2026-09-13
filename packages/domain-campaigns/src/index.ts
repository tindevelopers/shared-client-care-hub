/**
 * @tindevelopers/domain-campaigns — public surface.
 *
 * - `createCampaignStore(client, tenantId)` — tenant-scoped campaigns /
 *   campaign_recipients access with query-shape parity to the konnect server
 *   actions (`apps/app/app/actions/campaigns/campaigns.ts`).
 * - `nextAllowedStartUtc(...)` — calling-window scheduling, moved
 *   byte-identical from `apps/app/src/core/campaigns/scheduling.ts`.
 * - `createMarketingCampaignService(deps)` — provider-agnostic marketing
 *   campaign orchestrator with fully injected dependencies (store, audience
 *   resolver, provider factory, event emitter). No production callers are
 *   added by this package's publication; consumers compose it themselves.
 *
 * Deferred to Phase 3 commerce (deliberately absent): automation-settings and
 * call-context-speech.
 */
export { createCampaignStore } from "./campaign-store.js";
export { nextAllowedStartUtc } from "./scheduling.js";
export { createMarketingCampaignService } from "./campaign-service.js";

export type {
  CampaignCreateInput,
  CampaignRecipientProjection,
  CampaignStats,
  CampaignStore,
  CampaignUpdateInput,
  ListRecipientsOptions,
} from "./types.js";
export type {
  CampaignEventEmit,
  CampaignEventEnvelope,
  CampaignResult,
  CreateCampaignInput,
  MarketingCampaignService,
  MarketingCampaignServiceDeps,
  MaterializedAudience,
  SegmentDefinition,
} from "./campaign-service.js";
