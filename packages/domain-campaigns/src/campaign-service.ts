/**
 * Campaign Service — Provider-agnostic marketing campaign orchestrator
 *
 * Central hub for creating, scheduling, and tracking marketing email
 * campaigns. Talks to any registered MarketingAutomationProvider obtained
 * through the injected `getProvider` factory, never directly to a vendor SDK
 * (R1 — ports only).
 *
 * Flow for a new campaign:
 *   1. Resolve provider via `deps.getProvider()` + check feature flag.
 *   2. Materialize audience via `deps.resolveAudience` (segment → provider
 *      list, opt-out filtered upstream — R5: the resolver is an injected
 *      callback, never a cross-domain import).
 *   3. provider.createCampaign(...) → store providerCampaignId in settings.
 *   4. provider.scheduleCampaign(id, sendAt) when scheduleAt is present.
 *   5. Emit timeline activity via `deps.emit` (campaign created).
 *   6. Engagement flows back via provider webhooks automatically.
 *
 * Idempotency: re-running a send on an already-sent campaign is a no-op.
 * Suppression: opt-out is checked inside the audience resolver; the provider
 * list only ever contains the materialized contacts.
 *
 * Promoted from `apps/app/src/core/campaigns/campaign-service.ts` with the
 * dependencies injected (`{ campaigns, resolveAudience, getProvider, emit }`):
 * the app-local copy constructed an admin client, resolved the tenant's
 * integration connection row, and initialized the provider with placeholder
 * mock credentials. All of that client/credential lifecycle now belongs to
 * the host composition: the service here receives an already-configured
 * provider through `getProvider` and a store bound to the right tenant, so
 * this module constructs no clients (R1/R5 enforced by dependency-cruiser)
 * and is exercised purely with stubs in its characterization tests. Two
 * behavioral notes:
 *   - the `settings.provider` bookkeeping value now records
 *     `provider.providerSlug` instead of a hardcoded vendor literal — the
 *     identical runtime value in the real composition, and
 *   - a failing campaign insert now rejects (the store owns error
 *     propagation) instead of the app-local swallow-and-continue.
 */
import { createLogger } from "@tindevelopers/core-kernel/logger";
import type {
  MarketingAutomationProvider,
  MarketingCampaignReport,
} from "@tindevelopers/adapter-kit/marketing/marketing-interface";
import type { CampaignStore } from "./types.js";

const log = createLogger("campaigns/service");

// ──── Types ────────────────────────────────────────────────────────────

/**
 * Segment definition passed through to the injected audience resolver.
 * Structurally compatible with the contacts-domain SegmentDefinition
 * (tags / lifecycleStage / contactGroupId / customFilter) — deliberately
 * local: domains never import domains (R5).
 */
export interface SegmentDefinition {
  /** Filter by contact tags. */
  tags?: string[];
  /** Filter by lifecycle stage. */
  lifecycleStage?: string;
  /** Filter by contact group id. */
  contactGroupId?: string;
  /** Arbitrary custom filter appended to the query WHERE clause. */
  customFilter?: Record<string, unknown>;
}

/** Audience materialization result supplied by the injected resolver. */
export interface MaterializedAudience {
  /** Number of contacts in the segment (before opt-out filtering). */
  segmentCount: number;
  /** Number of contacts excluded due to opt-out. */
  optedOutCount: number;
  /** Number of contacts actually materialized into the provider list. */
  materializedCount: number;
  /** The provider list id used. */
  listId: number;
  /** Email addresses that were materialized. */
  emails: string[];
}

/** Envelope handed to the injected emit — matches the core-kernel event shape. */
export interface CampaignEventEnvelope {
  idempotencyKey: string;
  occurredAt: string;
  actor: { type: string };
  refs: { tenantId: string; campaignId: string };
  data: Record<string, unknown>;
}

/** Injected event emitter (the host binds this to the kernel event bus). */
export type CampaignEventEmit = (
  type: string,
  envelope: CampaignEventEnvelope,
) => Promise<unknown>;

export interface CreateCampaignInput {
  tenantId: string;
  name: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  templateId?: number;
  htmlContent?: string;
  segment: SegmentDefinition;
  listName?: string;
  scheduleAt?: string; // ISO-8601; if absent, campaign stays in draft
  replyTo?: string;
}

export interface CampaignResult {
  konnectCampaignId: string;
  providerCampaignId: string;
  listId: number;
  audienceCount: number;
  optedOutCount: number;
  status: string;
}

/** Injected dependencies — the host app supplies every external effect. */
export interface MarketingCampaignServiceDeps {
  /** Campaign store bound to the campaign's tenant. */
  campaigns: CampaignStore;
  /** Audience resolver callback (R5 seam: segment → provider list). */
  resolveAudience: (
    tenantId: string,
    segment: SegmentDefinition,
    listName: string,
  ) => MaterializedAudience | Promise<MaterializedAudience>;
  /** Provider factory; null when no marketing provider is registered. */
  getProvider: () => MarketingAutomationProvider | null;
  /** Event emitter bound to the kernel event bus. */
  emit: CampaignEventEmit;
}

export interface MarketingCampaignService {
  /** Create and optionally schedule a marketing campaign. */
  createMarketingCampaign(input: CreateCampaignInput): Promise<CampaignResult>;
  /** Send a draft campaign immediately. Idempotent on sent/completed. */
  sendCampaignNow(
    tenantId: string,
    konnectCampaignId: string,
  ): Promise<{ sent: boolean; reason?: string }>;
  /** Fetch the latest campaign report from the provider. */
  getCampaignReport(
    tenantId: string,
    konnectCampaignId: string,
  ): Promise<MarketingCampaignReport | null>;
  /** Trigger a lifecycle automation for a contact. */
  triggerLifecycleAutomation(
    tenantId: string,
    providerContactId: string,
    automationKey: string,
  ): Promise<void>;
}

// ──── Public API ────────────────────────────────────────────────────────

export function createMarketingCampaignService(
  deps: MarketingCampaignServiceDeps,
): MarketingCampaignService {
  return {
    /**
     * Create and optionally schedule a marketing campaign.
     */
    async createMarketingCampaign(input: CreateCampaignInput): Promise<CampaignResult> {
      const provider = deps.getProvider();

      if (!provider) {
        throw new Error("Brevo marketing provider not registered");
      }

      // 1. Materialize audience (segment → provider list, opt-out filtered
      //    upstream by the injected resolver).
      const listName = input.listName ?? `${input.name} - Audience`;
      const audience = await deps.resolveAudience(input.tenantId, input.segment, listName);

      if (audience.materializedCount === 0) {
        log.warn("No contacts in audience after materialization", {
          tenantId: input.tenantId,
          segmentCount: audience.segmentCount,
          optedOutCount: audience.optedOutCount,
        });
      }

      // 2. Create the campaign in the provider
      const providerCampaignId = await provider.createCampaign({
        konnectCampaignId: "", // filled below after DB insert
        tenantId: input.tenantId,
        name: input.name,
        subject: input.subject,
        senderName: input.senderName,
        senderEmail: input.senderEmail,
        templateId: input.templateId,
        htmlContent: input.htmlContent,
        listId: audience.listId,
        replyTo: input.replyTo,
      });

      // 3. Store campaign record through the injected tenant-bound store
      const konnectCampaignId = await deps.campaigns.create({
        name: input.name,
        description: `Marketing campaign via Brevo`,
        status: input.scheduleAt ? "scheduled" : "draft",
        campaign_type: "email",
        settings: {
          providerCampaignId,
          provider: provider.providerSlug,
          listId: audience.listId,
          templateId: input.templateId,
          segment: input.segment,
          audienceCount: audience.materializedCount,
        },
        schedule_start: input.scheduleAt ?? null,
      });

      // 4. Schedule if requested
      if (input.scheduleAt && providerCampaignId) {
        await provider.scheduleCampaign(providerCampaignId, input.scheduleAt);
        log.info("Campaign scheduled", {
          konnectCampaignId,
          providerCampaignId,
          scheduleAt: input.scheduleAt,
        });
      }

      // 5. Emit timeline activity. The event-name quirk
      //    ("campaign.opted_in" for a campaign-created event) is preserved
      //    verbatim from the app-local service; consumers key on the
      //    `campaign:<id>:created` idempotency key.
      await deps.emit("campaign.opted_in", {
        idempotencyKey: `campaign:${konnectCampaignId}:created`,
        occurredAt: new Date().toISOString(),
        actor: { type: "user" },
        refs: {
          tenantId: input.tenantId,
          campaignId: konnectCampaignId,
        },
        data: {
          email: input.subject,
          listKey: listName,
        },
      });

      return {
        konnectCampaignId,
        providerCampaignId,
        listId: audience.listId,
        audienceCount: audience.materializedCount,
        optedOutCount: audience.optedOutCount,
        status: input.scheduleAt ? "scheduled" : "draft",
      };
    },

    /**
     * Send a draft campaign immediately.
     */
    async sendCampaignNow(
      tenantId: string,
      konnectCampaignId: string,
    ): Promise<{ sent: boolean; reason?: string }> {
      void tenantId; // tenant scoping is provided by the bound store

      const campaign = await deps.campaigns.get(konnectCampaignId);

      if (!campaign) {
        return { sent: false, reason: "Campaign not found" };
      }

      const providerCampaignId = (campaign.settings as Record<string, unknown> | null)
        ?.providerCampaignId as string | undefined;

      if (!providerCampaignId) {
        return { sent: false, reason: "No provider campaign id" };
      }

      // Original behavior preserved verbatim, including the "sent" status
      // comparison/write (the app-local service wrote it the same way).
      const status = campaign.status as string | null;
      if (status === "sent" || status === "completed") {
        return { sent: false, reason: "Campaign already sent" };
      }

      const provider = deps.getProvider();
      if (!provider) {
        return { sent: false, reason: "Provider not available" };
      }

      await provider.sendCampaign(providerCampaignId);

      await deps.campaigns.update(konnectCampaignId, {
        status: "sent",
      });

      log.info("Campaign sent", { konnectCampaignId, providerCampaignId });

      return { sent: true };
    },

    /**
     * Fetch the latest campaign report from the provider.
     */
    async getCampaignReport(
      tenantId: string,
      konnectCampaignId: string,
    ): Promise<MarketingCampaignReport | null> {
      void tenantId; // tenant scoping is provided by the bound store

      const campaign = await deps.campaigns.get(konnectCampaignId);

      if (!campaign) return null;

      const providerCampaignId = (campaign.settings as Record<string, unknown> | null)
        ?.providerCampaignId as string | undefined;

      if (!providerCampaignId) return null;

      const provider = deps.getProvider();
      if (!provider) return null;

      return provider.getCampaignReport(providerCampaignId);
    },

    /**
     * Trigger a lifecycle automation for a contact.
     */
    async triggerLifecycleAutomation(
      tenantId: string,
      providerContactId: string,
      automationKey: string,
    ): Promise<void> {
      const provider = deps.getProvider();
      if (!provider?.triggerAutomation) {
        log.warn("Provider does not support automations", {
          providerSlug: provider?.providerSlug ?? null,
        });
        return;
      }

      await provider.triggerAutomation(providerContactId, automationKey as never);
      log.info("Lifecycle automation triggered", { tenantId, automationKey });
    },
  };
}
