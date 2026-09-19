/**
 * Characterization tests for createMarketingCampaignService with injected
 * stub dependencies (VAL-CAMPAIGNS-005): an in-memory CampaignStore fake, a
 * scripted audience resolver, a mock MarketingAutomationProvider, and a
 * recording emitter. No database, no network, no admin client — the service
 * factory must instantiate purely from its deps.
 *
 * Pinned behaviors (from the app-local campaign-service.ts, promoted here):
 * - create→schedule flow: provider.createCampaign gets the materialized listId,
 *   the campaign is stored "scheduled" when scheduleAt is present ("draft"
 *   otherwise), provider.scheduleCampaign receives the ISO time, emit fires
 *   once with idempotency key `campaign:<id>:created` (the existing
 *   event-name quirk — "campaign.opted_in" — is preserved verbatim).
 * - idempotent re-send: sendCampaignNow on a "sent"/"completed" campaign is a
 *   no-op returning { sent: false, reason: "Campaign already sent" }.
 * - opt-out filtering happens upstream in resolveAudience; optedOutCount is
 *   surfaced and the provider only ever sees the materialized list id.
 * - zero-audience warn-and-continue; throw on null provider.
 */
import { describe, expect, test } from "vitest";
import type { MarketingAutomationProvider } from "@tindevelopers/adapter-kit/marketing/marketing-interface";
import { createMarketingCampaignService, type CampaignEventEnvelope } from "../campaign-service.js";
import type { CampaignStore } from "../types.js";

const TENANT = "tenant-1";

interface StoreCall {
  op: "create" | "update" | "get";
  args: unknown[];
}

function createFakeStore(seeded: Record<string, Record<string, unknown>> = {}) {
  const rows = new Map<string, Record<string, unknown>>(Object.entries(seeded));
  const calls: StoreCall[] = [];
  let seq = 0;
  const store: CampaignStore = {
    async list() {
      return [];
    },
    async get(id) {
      calls.push({ op: "get", args: [id] });
      return (rows.get(id) as never) ?? null;
    },
    async create(input) {
      seq += 1;
      const id = `camp-${seq}`;
      calls.push({ op: "create", args: [{ ...input }] });
      rows.set(id, { id, ...input });
      return id;
    },
    async update(id, patch) {
      calls.push({ op: "update", args: [id, { ...patch }] });
      const row = rows.get(id);
      if (row) Object.assign(row, patch);
    },
    async softDelete() {
      throw new Error("not used by the service");
    },
    async transition() {
      throw new Error("not used by the service");
    },
    async replaceRecipients() {
      throw new Error("not used by the service");
    },
    async getStats() {
      return null;
    },
    async listRecipients() {
      return [];
    },
    async getRecipientTimezoneStats() {
      return {};
    },
  };
  return { store, calls, rows };
}

interface ProviderCalls {
  initialize: unknown[][];
  createCampaign: unknown[];
  scheduleCampaign: unknown[][];
  sendCampaign: unknown[];
  getCampaignReport: unknown[];
  triggerAutomation: unknown[][];
}

function createMockProvider(withAutomation = true) {
  const calls: ProviderCalls = {
    initialize: [],
    createCampaign: [],
    scheduleCampaign: [],
    sendCampaign: [],
    getCampaignReport: [],
    triggerAutomation: [],
  };
  const provider: MarketingAutomationProvider = {
    name: "Mock Marketing",
    providerSlug: "brevo",
    channel: "email",
    initialize: async (...args: unknown[]) => {
      calls.initialize.push(args);
    },
    createCampaign: async (def) => {
      calls.createCampaign.push(def);
      return "prov-camp-1";
    },
    scheduleCampaign: async (...args: unknown[]) => {
      calls.scheduleCampaign.push(args);
    },
    sendCampaign: async (id) => {
      calls.sendCampaign.push(id);
    },
    getCampaignReport: async (id) => {
      calls.getCampaignReport.push(id);
      return {
        providerCampaignId: id,
        status: "sent",
        sent: 10,
        delivered: 9,
        opened: 5,
        clicked: 2,
        bounced: 1,
        unsubscribed: 0,
        complaints: 0,
      };
    },
    createList: async () => 1,
    addContactsToList: async () => {},
    healthCheck: async () => true,
    ...(withAutomation
      ? {
          triggerAutomation: async (...args: unknown[]) => {
            calls.triggerAutomation.push(args);
          },
        }
      : {}),
  };
  return { provider, calls };
}

const AUDIENCE = {
  segmentCount: 8,
  optedOutCount: 3,
  materializedCount: 5,
  listId: 4242,
  emails: ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"],
};

function baseInput() {
  return {
    tenantId: TENANT,
    name: "Test Campaign",
    subject: "Hello there",
    senderName: "Konnect",
    senderEmail: "no-reply@example.com",
    templateId: 7,
    htmlContent: "<p>hi</p>",
    segment: { tags: ["vip"] },
  };
}

function makeService(overrides: Partial<Parameters<typeof createMarketingCampaignService>[0]> = {}) {
  const fakeStore = createFakeStore();
  const { provider, calls: providerCalls } = createMockProvider();
  const emitted: Array<{ type: string; envelope: CampaignEventEnvelope }> = [];
  const resolveCalls: unknown[][] = [];
  let audienceResult: unknown = AUDIENCE;
  const service = createMarketingCampaignService({
    campaigns: fakeStore.store,
    resolveAudience: async (...args: unknown[]) => {
      resolveCalls.push(args);
      return audienceResult as never;
    },
    getProvider: () => provider,
    emit: async (type, envelope) => {
      emitted.push({ type, envelope });
    },
    ...overrides,
  });
  return {
    service,
    fakeStore,
    provider,
    providerCalls,
    emitted,
    resolveCalls,
    setAudience: (a: unknown) => (audienceResult = a),
  };
}

describe("createMarketingCampaignService (injected stub deps)", () => {
  test("instantiates purely from deps — no client/env construction", () => {
    const { service } = makeService();
    expect(typeof service.createMarketingCampaign).toBe("function");
    expect(typeof service.sendCampaignNow).toBe("function");
    expect(typeof service.getCampaignReport).toBe("function");
    expect(typeof service.triggerLifecycleAutomation).toBe("function");
  });

  test("create→schedule flow: scheduled campaign, provider called with listId, emit keyed campaign:<id>:created", async () => {
    const scheduleAt = "2026-10-01T12:00:00.000Z";
    const { service, fakeStore, providerCalls, emitted, resolveCalls } = makeService();

    const result = await service.createMarketingCampaign({ ...baseInput(), scheduleAt });

    // Audience resolved with (tenantId, segment, default list name).
    expect(resolveCalls).toEqual([[TENANT, { tags: ["vip"] }, "Test Campaign - Audience"]]);

    // Provider received the materialized listId and the full definition.
    expect(providerCalls.createCampaign).toHaveLength(1);
    const def = providerCalls.createCampaign[0] as Record<string, unknown>;
    expect(def.listId).toBe(4242);
    expect(def.konnectCampaignId).toBe(""); // filled after the DB insert
    expect(def.tenantId).toBe(TENANT);
    expect(def.name).toBe("Test Campaign");
    expect(def.subject).toBe("Hello there");
    expect(def.senderName).toBe("Konnect");
    expect(def.senderEmail).toBe("no-reply@example.com");
    expect(def.templateId).toBe(7);
    expect(def.htmlContent).toBe("<p>hi</p>");

    // Campaign stored via the injected store: scheduled, email type,
    // provider bookkeeping in settings, schedule_start set.
    const create = fakeStore.calls.find((c) => c.op === "create")!;
    expect(create.args[0]).toEqual({
      name: "Test Campaign",
      description: "Marketing campaign via Brevo",
      status: "scheduled",
      campaign_type: "email",
      settings: {
        providerCampaignId: "prov-camp-1",
        provider: "brevo",
        listId: 4242,
        templateId: 7,
        segment: { tags: ["vip"] },
        audienceCount: 5,
      },
      schedule_start: scheduleAt,
    });

    // Provider scheduling invoked with the ISO time.
    expect(providerCalls.scheduleCampaign).toEqual([["prov-camp-1", scheduleAt]]);

    // Emit fired exactly once, with the idempotency-key quirk preserved.
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe("campaign.opted_in");
    expect(emitted[0].envelope.idempotencyKey).toBe("campaign:camp-1:created");
    expect(emitted[0].envelope.refs).toEqual({ tenantId: TENANT, campaignId: "camp-1" });
    expect(emitted[0].envelope.data).toEqual({ email: "Hello there", listKey: "Test Campaign - Audience" });

    expect(result).toEqual({
      konnectCampaignId: "camp-1",
      providerCampaignId: "prov-camp-1",
      listId: 4242,
      audienceCount: 5,
      optedOutCount: 3,
      status: "scheduled",
    });
  });

  test("create without scheduleAt stores a draft and never calls scheduleCampaign", async () => {
    const { service, fakeStore, providerCalls, emitted } = makeService();

    const result = await service.createMarketingCampaign(baseInput());

    expect(result.status).toBe("draft");
    expect(providerCalls.scheduleCampaign).toHaveLength(0);
    const create = fakeStore.calls.find((c) => c.op === "create")!;
    expect((create.args[0] as Record<string, unknown>).status).toBe("draft");
    expect((create.args[0] as Record<string, unknown>).schedule_start).toBeNull();
    // The created event is emitted for drafts too.
    expect(emitted[0].envelope.idempotencyKey).toBe("campaign:camp-1:created");
  });

  test("re-send on already-sent campaign is a no-op that never calls the provider", async () => {
    const { service, providerCalls, fakeStore } = makeService();
    fakeStore.rows.set("camp-9", {
      id: "camp-9",
      status: "sent",
      settings: { providerCampaignId: "prov-old" },
    });

    await expect(service.sendCampaignNow(TENANT, "camp-9")).resolves.toEqual({
      sent: false,
      reason: "Campaign already sent",
    });
    expect(providerCalls.sendCampaign).toHaveLength(0);
    expect(fakeStore.calls.find((c) => c.op === "update")).toBeUndefined();
  });

  test("re-send on completed campaign is also a no-op", async () => {
    const { store } = createFakeStore({
      "camp-c": { id: "camp-c", status: "completed", settings: { providerCampaignId: "prov-old" } },
    });
    const mock = createMockProvider();
    const svc = createMarketingCampaignService({
      campaigns: store,
      resolveAudience: async () => AUDIENCE,
      getProvider: () => mock.provider,
      emit: async () => {},
    });

    await expect(svc.sendCampaignNow(TENANT, "camp-c")).resolves.toEqual({
      sent: false,
      reason: "Campaign already sent",
    });
    expect(mock.calls.sendCampaign).toHaveLength(0);
  });

  test("opt-out count surfaced from resolveAudience; provider receives only the materialized list id", async () => {
    const { service, providerCalls } = makeService();

    const result = await service.createMarketingCampaign(baseInput());

    expect(result.optedOutCount).toBe(3);
    expect(result.audienceCount).toBe(5);
    // Filtering happened upstream: the provider never sees audience emails,
    // only the materialized list id inside the campaign definition.
    const def = providerCalls.createCampaign[0] as Record<string, unknown>;
    expect(def.listId).toBe(AUDIENCE.listId);
    expect(def).not.toHaveProperty("emails");
    for (const email of AUDIENCE.emails) {
      expect(JSON.stringify(def)).not.toContain(email);
    }
  });

  test("throws when provider missing (before any audience resolution)", async () => {
    const { service, resolveCalls } = makeService({ getProvider: () => null });

    await expect(service.createMarketingCampaign(baseInput())).rejects.toThrow(
      "Brevo marketing provider not registered",
    );
    expect(resolveCalls).toHaveLength(0);
  });

  test("zero-audience warn-and-continue: campaign still created and returned", async () => {
    const svc = makeServiceWithAudience({
      segmentCount: 4,
      optedOutCount: 4,
      materializedCount: 0,
      listId: 0,
      emails: [],
    });

    const result = await svc.service.createMarketingCampaign(baseInput());

    expect(result).toMatchObject({ audienceCount: 0, optedOutCount: 4, status: "draft" });
    // Continued through provider create + store insert despite the empty audience.
    expect(svc.providerCalls.createCampaign).toHaveLength(1);
    const create = svc.fakeStore.calls.find((c) => c.op === "create");
    expect(create).toBeDefined();
    expect((create!.args[0] as Record<string, unknown>).settings).toMatchObject({
      audienceCount: 0,
    });
  });

  test("sendCampaignNow happy path: provider sends, campaign marked sent via the store", async () => {
    const { service, fakeStore, providerCalls } = makeService();
    fakeStore.rows.set("camp-d", {
      id: "camp-d",
      status: "draft",
      settings: { providerCampaignId: "prov-camp-1" },
    });

    await expect(service.sendCampaignNow(TENANT, "camp-d")).resolves.toEqual({ sent: true });
    expect(providerCalls.sendCampaign).toEqual(["prov-camp-1"]);
    const update = fakeStore.calls.find((c) => c.op === "update")!;
    expect(update.args[0]).toBe("camp-d");
    expect((update.args[1] as Record<string, unknown>).status).toBe("sent");
  });

  test("sendCampaignNow early-return reasons: not found, no provider campaign id, provider unavailable", async () => {
    const { service, fakeStore } = makeService();

    await expect(service.sendCampaignNow(TENANT, "missing")).resolves.toEqual({
      sent: false,
      reason: "Campaign not found",
    });

    fakeStore.rows.set("camp-np", { id: "camp-np", status: "draft", settings: {} });
    await expect(service.sendCampaignNow(TENANT, "camp-np")).resolves.toEqual({
      sent: false,
      reason: "No provider campaign id",
    });

    const noProvider = makeService({ getProvider: () => null });
    noProvider.fakeStore.rows.set("camp-x", {
      id: "camp-x",
      status: "draft",
      settings: { providerCampaignId: "prov-1" },
    });
    await expect(noProvider.service.sendCampaignNow(TENANT, "camp-x")).resolves.toEqual({
      sent: false,
      reason: "Provider not available",
    });
  });

  test("getCampaignReport returns the provider report, or null on missing pieces", async () => {
    const { service, fakeStore, providerCalls } = makeService();
    fakeStore.rows.set("camp-r", {
      id: "camp-r",
      status: "draft",
      settings: { providerCampaignId: "prov-camp-1" },
    });

    const report = await service.getCampaignReport(TENANT, "camp-r");
    expect(providerCalls.getCampaignReport).toEqual(["prov-camp-1"]);
    expect(report).toMatchObject({ providerCampaignId: "prov-camp-1", sent: 10 });

    // Missing campaign → null; missing providerCampaignId → null; no provider → null.
    await expect(service.getCampaignReport(TENANT, "missing")).resolves.toBeNull();
    fakeStore.rows.set("camp-r2", { id: "camp-r2", status: "draft", settings: {} });
    await expect(service.getCampaignReport(TENANT, "camp-r2")).resolves.toBeNull();
    const noProvider = makeService({ getProvider: () => null });
    noProvider.fakeStore.rows.set("camp-r3", {
      id: "camp-r3",
      status: "draft",
      settings: { providerCampaignId: "prov-1" },
    });
    await expect(noProvider.service.getCampaignReport(TENANT, "camp-r3")).resolves.toBeNull();
  });

  test("triggerLifecycleAutomation calls the provider; providers without automations resolve silently", async () => {
    const withAutomation = makeService();
    await withAutomation.service.triggerLifecycleAutomation(TENANT, "prov-contact-1", "onboarding");
    expect(withAutomation.providerCalls.triggerAutomation).toEqual([["prov-contact-1", "onboarding"]]);

    const { service } = makeService({
      getProvider: () => createMockProvider(false).provider,
    });
    await expect(
      service.triggerLifecycleAutomation(TENANT, "prov-contact-1", "onboarding"),
    ).resolves.toBeUndefined();
  });
});

// ── helper: a service whose resolveAudience always returns a fixed audience ─

function makeServiceWithAudience(audience: unknown) {
  const fakeStore = createFakeStore();
  const { provider, calls } = createMockProvider();
  const service = createMarketingCampaignService({
    campaigns: fakeStore.store,
    resolveAudience: async () => audience as never,
    getProvider: () => provider,
    emit: async () => {},
  });
  return { service, fakeStore, providerCalls: calls };
}
