/**
 * Payload-parity tests for the campaign store against the exact query shapes
 * of `apps/app/app/actions/campaigns/campaigns.ts` (VAL-CAMPAIGNS-009) and
 * tenant-isolation coverage (VAL-CAMPAIGNS-010, mocked-client option: every
 * operation asserts `.eq("tenant_id", …)`).
 *
 * Parity sources (konnect repo, ground truth):
 * - getCampaigns      → list()          campaigns.ts:63-74
 * - getCampaign       → get()           campaigns.ts:76-90   (PGRST116 → null)
 * - createCampaign    → create()        campaigns.ts:92-135  (exact row defaults)
 * - updateCampaign    → update()        campaigns.ts:137-174 (partial patch, no updated_at)
 * - deleteCampaign    → softDelete()    campaigns.ts:176-231 (deleted_at + status cancelled, live rows only)
 * - getCampaignStats  → getStats()      campaigns.ts:233-262 (tally; unknown status → total only)
 * - getCampaignRecipients → listRecipients() campaigns.ts:275-294 (13-column projection, range pagination)
 * - getRecipientTimezoneStats → getRecipientTimezoneStats() campaigns.ts:305-318 ('Unknown' bucketing)
 */
import { describe, expect, test } from "vitest";
import { createCampaignStore } from "../campaign-store.js";
import type { CampaignUpdateInput } from "../types.js";
import { createMockSupabase, type RecordedCall } from "./helpers/mock-supabase.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Calls with op === op, excluding from/single terminal markers. */
function opsOf(calls: RecordedCall[], op: string): RecordedCall[] {
  return calls.filter((c) => c.op === op);
}

function argsOf(calls: RecordedCall[], op: string): unknown[][] {
  return opsOf(calls, op).map((c) => c.args);
}

describe("campaign store read parity", () => {
  test("list selects * with tenant + soft-delete filters, newest first (getCampaigns parity)", async () => {
    const row = { id: "r1", name: "C" };
    const { client, calls } = createMockSupabase({ data: [row], error: null });
    const store = createCampaignStore(client, TENANT_A);

    const out = await store.list();

    expect(out).toEqual([row]);
    expect(calls[0]).toEqual({ op: "from", args: ["campaigns"] });
    expect(argsOf(calls, "select")).toEqual([["*"]]);
    expect(argsOf(calls, "eq")).toEqual([["tenant_id", TENANT_A]]);
    expect(argsOf(calls, "is")).toEqual([["deleted_at", null]]);
    expect(argsOf(calls, "order")).toEqual([["created_at", { ascending: false }]]);
  });

  test("list returns [] when data is null and throws on error", async () => {
    const empty = createMockSupabase({ data: null, error: null });
    const store = createCampaignStore(empty.client, TENANT_A);
    await expect(store.list()).resolves.toEqual([]);

    const failing = createMockSupabase({ data: null, error: { message: "boom" } });
    const store2 = createCampaignStore(failing.client, TENANT_A);
    await expect(store2.list()).rejects.toEqual({ message: "boom" });
  });

  test("get returns full row, filters soft-deleted, maps PGRST116 to null (getCampaign parity)", async () => {
    const row = { id: CAMPAIGN_ID, name: "C" };
    const { client, calls } = createMockSupabase({ data: row, error: null });
    const store = createCampaignStore(client, TENANT_A);

    const out = await store.get(CAMPAIGN_ID);

    expect(out).toEqual(row);
    expect(calls[0]).toEqual({ op: "from", args: ["campaigns"] });
    expect(argsOf(calls, "select")).toEqual([["*"]]);
    expect(argsOf(calls, "eq")).toEqual([
      ["id", CAMPAIGN_ID],
      ["tenant_id", TENANT_A],
    ]);
    expect(argsOf(calls, "is")).toEqual([["deleted_at", null]]);
    expect(opsOf(calls, "single")).toHaveLength(1);
  });

  test("get returns null for unknown/soft-deleted id (PGRST116) and rethrows other errors", async () => {
    const missing = createMockSupabase({ data: null, error: { code: "PGRST116" } });
    const store = createCampaignStore(missing.client, TENANT_A);
    await expect(store.get("missing-id")).resolves.toBeNull();

    const broken = createMockSupabase({ data: null, error: { code: "42P01", message: "no table" } });
    const store2 = createCampaignStore(broken.client, TENANT_A);
    await expect(store2.get("x")).rejects.toEqual({ code: "42P01", message: "no table" });
  });
});

describe("campaign store write parity", () => {
  test("create inserts the exact createCampaign row payload and returns the id", async () => {
    const { client, calls } = createMockSupabase({ data: { id: CAMPAIGN_ID }, error: null });
    const store = createCampaignStore(client, TENANT_A);

    const id = await store.create({});

    expect(id).toBe(CAMPAIGN_ID);
    expect(calls[0]).toEqual({ op: "from", args: ["campaigns"] });
    // Exact row builder from createCampaign (campaigns.ts:109-128) with all
    // defaults, tenant injected by the store.
    expect(argsOf(calls, "insert")).toEqual([
      [
        {
          tenant_id: TENANT_A,
          name: "Untitled Campaign",
          description: null,
          status: "draft",
          campaign_type: "voice",
          assistant_id: null,
          from_number: null,
          message_template: null,
          schedule_start: null,
          schedule_end: null,
          calling_window_start: "09:00",
          calling_window_end: "20:00",
          timezone: "UTC",
          calling_days: [1, 2, 3, 4, 5],
          max_attempts: 3,
          retry_delay_minutes: 60,
          max_concurrent_calls: 5,
          calls_per_minute: 10,
          settings: {},
        },
      ],
    ]);
    expect(argsOf(calls, "select")).toEqual([["id"]]);
    expect(opsOf(calls, "single")).toHaveLength(1);
  });

  test("create applies caller overrides over the defaults", async () => {
    const { client, calls } = createMockSupabase({ data: { id: "x" }, error: null });
    const store = createCampaignStore(client, TENANT_A);

    await store.create({
      name: "Spring Outreach",
      campaign_type: "email",
      status: "scheduled",
      timezone: "Europe/Berlin",
      calling_days: [2, 4],
      settings: { provider: "p" },
    });

    const row = calls.find((c) => c.op === "insert")!.args[0] as Record<string, unknown>;
    expect(row.name).toBe("Spring Outreach");
    expect(row.campaign_type).toBe("email");
    expect(row.status).toBe("scheduled");
    expect(row.timezone).toBe("Europe/Berlin");
    expect(row.calling_days).toEqual([2, 4]);
    expect(row.settings).toEqual({ provider: "p" });
    // Untouched fields keep their defaults.
    expect(row.max_attempts).toBe(3);
  });

  test("create propagates insert errors", async () => {
    const { client } = createMockSupabase({ data: null, error: { message: "CHECK violation" } });
    const store = createCampaignStore(client, TENANT_A);
    await expect(store.create({})).rejects.toEqual({ message: "CHECK violation" });
  });

  test("update patches the caller's partial without writing updated_at (updateCampaign parity)", async () => {
    const { client, calls } = createMockSupabase({ data: null, error: null });
    const store = createCampaignStore(client, TENANT_A);

    const patch: CampaignUpdateInput = { status: "paused", settings: { a: 1 } };
    await store.update(CAMPAIGN_ID, patch);

    expect(calls[0]).toEqual({ op: "from", args: ["campaigns"] });
    // The exact same object is passed through — the store never injects
    // updated_at (the DB trigger update_campaigns_updated_at owns it).
    expect(argsOf(calls, "update")).toEqual([[patch]]);
    expect(argsOf(calls, "eq")).toEqual([
      ["id", CAMPAIGN_ID],
      ["tenant_id", TENANT_A],
    ]);
    // updateCampaign applies NO deleted_at filter.
    expect(opsOf(calls, "is")).toHaveLength(0);
  });

  test("update propagates errors", async () => {
    const { client } = createMockSupabase({ data: null, error: { message: "nope" } });
    const store = createCampaignStore(client, TENANT_A);
    await expect(store.update(CAMPAIGN_ID, { name: "x" })).rejects.toEqual({ message: "nope" });
  });

  test("softDelete sets deleted_at (ISO) + status cancelled on live rows only (deleteCampaign parity)", async () => {
    const before = Date.now();
    const { client, calls } = createMockSupabase({ data: null, error: null });
    const store = createCampaignStore(client, TENANT_A);

    await store.softDelete(CAMPAIGN_ID);
    const after = Date.now();

    expect(calls[0]).toEqual({ op: "from", args: ["campaigns"] });
    const [updateArg] = argsOf(calls, "update")[0] as Array<Record<string, unknown>>;
    expect(updateArg.status).toBe("cancelled");
    const deletedAt = updateArg.deleted_at as string;
    expect(new Date(deletedAt).toISOString()).toBe(deletedAt); // ISO-8601 string
    expect(Date.parse(deletedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(deletedAt)).toBeLessThanOrEqual(after);
    expect(argsOf(calls, "eq")).toEqual([
      ["id", CAMPAIGN_ID],
      ["tenant_id", TENANT_A],
    ]);
    expect(argsOf(calls, "is")).toEqual([["deleted_at", null]]); // live rows only
  });
});

describe("campaign store stats and recipients parity", () => {
  test("getStats matches CampaignStats fields; unknown status increments total only", async () => {
    const { client, calls } = createMockSupabase({
      data: [
        { status: "pending" },
        { status: "pending" },
        { status: "completed" },
        { status: "failed" },
        { status: "weird_custom_status" },
      ],
      error: null,
    });
    const store = createCampaignStore(client, TENANT_A);

    const stats = await store.getStats(CAMPAIGN_ID);

    // Deep-equal the exact 10-field shape (campaigns.ts:50-61); the unknown
    // status contributes to total ONLY.
    expect(stats).toEqual({
      total: 5,
      pending: 2,
      scheduled: 0,
      in_progress: 0,
      completed: 1,
      failed: 1,
      skipped: 0,
      opted_out: 0,
      no_answer: 0,
      voicemail: 0,
    });
    expect(Object.keys(stats as object).sort()).toEqual(
      [
        "total",
        "pending",
        "scheduled",
        "in_progress",
        "completed",
        "failed",
        "skipped",
        "opted_out",
        "no_answer",
        "voicemail",
      ].sort(),
    );
    expect(calls[0]).toEqual({ op: "from", args: ["campaign_recipients"] });
    expect(argsOf(calls, "select")).toEqual([["status"]]);
    expect(argsOf(calls, "eq")).toEqual([
      ["campaign_id", CAMPAIGN_ID],
      ["tenant_id", TENANT_A],
    ]);
  });

  test("getStats returns null on query error (getCampaignStats parity)", async () => {
    const { client } = createMockSupabase({ data: null, error: { message: "boom" } });
    const store = createCampaignStore(client, TENANT_A);
    await expect(store.getStats(CAMPAIGN_ID)).resolves.toBeNull();
  });

  test("listRecipients uses the exact 13-column projection ordered created_at desc", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const { client, calls } = createMockSupabase({ data: rows, error: null });
    const store = createCampaignStore(client, TENANT_A);

    const out = await store.listRecipients(CAMPAIGN_ID);

    expect(out).toEqual(rows);
    expect(calls[0]).toEqual({ op: "from", args: ["campaign_recipients"] });
    expect(argsOf(calls, "select")).toEqual([
      [
        "id, campaign_id, first_name, last_name, phone, email, timezone, client_type, status, scheduled_at, attempts, completed_at, created_at",
      ],
    ]);
    expect(argsOf(calls, "eq")).toEqual([
      ["campaign_id", CAMPAIGN_ID],
      ["tenant_id", TENANT_A],
    ]);
    expect(argsOf(calls, "order")).toEqual([["created_at", { ascending: false }]]);
    // Defaults: limit 100, offset 0 → range(0, 99); no status filter.
    expect(argsOf(calls, "range")).toEqual([[0, 99]]);
    expect(opsOf(calls, "eq")).toHaveLength(2);
  });

  test("listRecipients honors status/limit/offset with range(offset, offset+limit-1)", async () => {
    const { client, calls } = createMockSupabase({ data: [], error: null });
    const store = createCampaignStore(client, TENANT_A);

    await store.listRecipients(CAMPAIGN_ID, { status: "pending", limit: 10, offset: 20 });

    expect(argsOf(calls, "eq")).toEqual([
      ["campaign_id", CAMPAIGN_ID],
      ["tenant_id", TENANT_A],
      ["status", "pending"],
    ]);
    expect(argsOf(calls, "range")).toEqual([[20, 29]]);
  });

  test("listRecipients throws on error", async () => {
    const { client } = createMockSupabase({ data: null, error: { message: "boom" } });
    const store = createCampaignStore(client, TENANT_A);
    await expect(store.listRecipients(CAMPAIGN_ID)).rejects.toEqual({ message: "boom" });
  });

  test("getRecipientTimezoneStats buckets null/empty timezone as Unknown", async () => {
    const { client, calls } = createMockSupabase({
      data: [
        { timezone: "America/New_York" },
        { timezone: "America/New_York" },
        { timezone: "Europe/London" },
        { timezone: null },
        { timezone: "" },
      ],
      error: null,
    });
    const store = createCampaignStore(client, TENANT_A);

    const counts = await store.getRecipientTimezoneStats(CAMPAIGN_ID);

    expect(counts).toEqual({
      "America/New_York": 2,
      "Europe/London": 1,
      Unknown: 2,
    });
    expect(calls[0]).toEqual({ op: "from", args: ["campaign_recipients"] });
    expect(argsOf(calls, "select")).toEqual([["timezone"]]);
    expect(argsOf(calls, "eq")).toEqual([
      ["campaign_id", CAMPAIGN_ID],
      ["tenant_id", TENANT_A],
    ]);
  });
});

describe("campaign store tenant isolation (cross-tenant)", () => {
  test("cross-tenant: every operation carries eq(tenant_id) on campaigns reads/writes", async () => {
    // Queue: list → null data, get → null data, create → id row; the tail
    // covers the remaining five operations.
    const { client, calls } = createMockSupabase([
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: "created" }, error: null },
    ]);
    const store = createCampaignStore(client, TENANT_A);

    await store.list();
    await store.get("foreign-id");
    const createdId = await store.create({});
    expect(createdId).toBe("created");
    await store.update("foreign-id", { name: "x" });
    await store.softDelete("foreign-id");
    await store.getStats("foreign-id");
    await store.listRecipients("foreign-id");
    await store.getRecipientTimezoneStats("foreign-id");

    // Seven operations filter with eq(tenant_id); create() embeds the tenant
    // in the insert payload instead (asserted below).
    const tenantFilters = calls.filter(
      (c) => c.op === "eq" && c.args[0] === "tenant_id",
    );
    expect(tenantFilters).toHaveLength(7);
    expect(tenantFilters.every((c) => c.args[1] === TENANT_A)).toBe(true);
    expect(tenantFilters.some((c) => c.args[1] === TENANT_B)).toBe(false);

    const insertRow = calls.find((c) => c.op === "insert")!.args[0] as Record<string, unknown>;
    expect(insertRow.tenant_id).toBe(TENANT_A);
  });

  test("cross-tenant: get on a foreign id resolves null (PGRST116 zero-row semantics)", async () => {
    const { client } = createMockSupabase({ data: null, error: { code: "PGRST116" } });
    const store = createCampaignStore(client, TENANT_A);
    await expect(store.get("foreign-id")).resolves.toBeNull();
  });

  test("cross-tenant: update/softDelete on a foreign id resolve as zero-row no-ops", async () => {
    const { client, calls } = createMockSupabase({ data: null, error: null });
    const store = createCampaignStore(client, TENANT_A);

    await expect(store.update("foreign-id", { name: "hijack" })).resolves.toBeUndefined();
    await expect(store.softDelete("foreign-id")).resolves.toBeUndefined();

    // Both writes are tenant-filtered: the eq(tenant_id, TENANT_A) chain means
    // a foreign row can never match.
    const writes = calls.filter((c) => c.op === "update");
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      const chain = calls.slice(calls.indexOf(w));
      expect(chain.some((c) => c.op === "eq" && c.args[0] === "tenant_id" && c.args[1] === TENANT_A)).toBe(true);
    }
  });
});
