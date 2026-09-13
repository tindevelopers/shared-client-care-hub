/**
 * Hosted-Supabase integration tests for the campaign store
 * (VAL-CAMPAIGNS-001/002/003/010).
 *
 * Rules honored (mission AGENTS.md):
 * - HOSTED Supabase only; keys come from the hub `.env` (gitignored) and are
 *   never printed.
 * - Every row this suite touches is created by the suite, marked with the
 *   `crm-val-<marker>` prefix (campaign names) / phone markers (recipients),
 *   and deleted in afterAll; existing hosted data is read-only (the only
 *   reads of pre-existing rows are the two tenant ids required by the
 *   campaigns.tenant_id FK).
 * - Cross-tenant cases verify byte-identical rows via full re-reads.
 *
 * The store is client-agnostic; these tests bind it to a service-role client
 * so synthetic rows inside real tenants work (tenant isolation then comes
 * from the store's own `.eq("tenant_id", …)` filters, which is exactly what
 * these tests prove).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createCampaignStore } from "../../campaign-store.js";

function loadHubEnv(): Record<string, string> {
  const envPath = fileURLToPath(new URL("../../../../../.env", import.meta.url));
  try {
    const raw = readFileSync(envPath, "utf8");
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => {
          const key = line.slice(0, line.indexOf("=")).trim();
          let value = line.slice(line.indexOf("=") + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}

const env = loadHubEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const hosted = SUPABASE_URL && SERVICE_ROLE_KEY ? describe : describe.skip;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.warn(
    "[hosted] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — campaign-store hosted integration tests SKIPPED (loudly)",
  );
}

/** Unique-per-run marker; every created row carries it so cleanup is precise. */
const MARKER = `crm-val-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

/**
 * Every effective `campaigns` column named in the ground-truth Part 1.3 DDL
 * composite (base table + deleted_at + timezone + 4 multi-turn guards + 4
 * marketing provider columns) — 32 columns.
 */
const ALL_CAMPAIGN_COLUMNS = [
  "id",
  "tenant_id",
  "name",
  "description",
  "status",
  "campaign_type",
  "assistant_id",
  "from_number",
  "message_template",
  "schedule_start",
  "schedule_end",
  "calling_window_start",
  "calling_window_end",
  "calling_days",
  "max_attempts",
  "retry_delay_minutes",
  "max_concurrent_calls",
  "calls_per_minute",
  "settings",
  "created_by",
  "created_at",
  "updated_at",
  "deleted_at",
  "timezone",
  "max_conversation_turns",
  "no_reply_timeout_minutes",
  "max_sends_per_recipient",
  "global_send_rate_per_minute",
  "provider",
  "provider_campaign_id",
  "template_ref",
  "segment_ref",
] as const;

/** The exact 13-column projection from getCampaignRecipients (campaigns.ts:279). */
const RECIPIENT_PROJECTION_COLUMNS = [
  "id",
  "campaign_id",
  "first_name",
  "last_name",
  "phone",
  "email",
  "timezone",
  "client_type",
  "status",
  "scheduled_at",
  "attempts",
  "completed_at",
  "created_at",
] as const;

let admin: SupabaseClient;
let tenantA = "";
let tenantB = "";
const createdCampaignIds: string[] = [];

async function seedCampaign(
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await (admin.from("campaigns") as any)
    .insert({
      tenant_id: tenantId,
      name: `${MARKER}-${randomUUID().slice(0, 8)}`,
      campaign_type: "voice",
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seedCampaign failed: ${error.message}`);
  createdCampaignIds.push(data.id as string);
  return data.id as string;
}

async function seedRecipient(
  campaignId: string,
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await (admin.from("campaign_recipients") as any)
    .insert({
      campaign_id: campaignId,
      tenant_id: tenantId,
      first_name: "Valcamp",
      last_name: "Recipient",
      phone: `${MARKER}-p${randomUUID().slice(0, 8)}`,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seedRecipient failed: ${error.message}`);
  return data.id as string;
}

async function readCampaignRow(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await (admin.from("campaigns") as any).select("*").eq("id", id).single();
  if (error) throw new Error(`readCampaignRow failed: ${error.message}`);
  return data as Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  // campaigns.tenant_id REFERENCES tenants(id) — use two real tenant ids purely
  // as scope keys (no tenant row is modified).
  const { data: tenants, error } = await (admin.from("tenants") as any)
    .select("id")
    .order("created_at")
    .limit(2);
  if (error) throw new Error(`tenant fetch failed: ${error.message}`);
  if (!tenants || tenants.length < 2) {
    throw new Error("[hosted] need at least two tenants for cross-tenant tests");
  }
  tenantA = tenants[0].id as string;
  tenantB = tenants[1].id as string;
}, 30_000);

afterAll(async () => {
  let deletedCampaigns = 0;
  if (createdCampaignIds.length > 0) {
    const { data } = await (admin.from("campaigns") as any)
      .delete()
      .in("id", createdCampaignIds)
      .select("id");
    deletedCampaigns = data?.length ?? 0;
  }
  // Belt and braces, marker-precise (never a broad crm-val-% sweep — another
  // validator run may be live with its own marker). Deleting campaigns
  // cascades their campaign_recipients (campaign_id ON DELETE CASCADE).
  await (admin.from("campaigns") as any).delete().like("name", `${MARKER}%`);
  const { count: campaignLeftover } = await (admin.from("campaigns") as any)
    .select("id", { count: "exact", head: true })
    .like("name", `${MARKER}%`);
  const { count: recipientLeftover } = await (admin.from("campaign_recipients") as any)
    .select("id", { count: "exact", head: true })
    .like("phone", `${MARKER}%`);
  console.log(
    `cleanup: deleted ${deletedCampaigns} test campaigns; leftover ${MARKER} campaigns: ${campaignLeftover ?? "?"}, leftover ${MARKER} recipients: ${recipientLeftover ?? "?"}`,
  );
  expect(campaignLeftover ?? 0).toBe(0);
  expect(recipientLeftover ?? 0).toBe(0);
}, 30_000);

hosted("campaign store list/get parity (VAL-CAMPAIGNS-001)", () => {
  test("list excludes soft-deleted rows and scopes to the tenant", async () => {
    const store = createCampaignStore(admin, tenantA);
    const liveId = await seedCampaign(tenantA);
    const deadId = await seedCampaign(tenantA, { deleted_at: new Date().toISOString() });

    const rows = await store.list();

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(deadId);
    // Every returned row is live and tenant-scoped.
    for (const row of rows) {
      expect(row.tenant_id).toBe(tenantA);
      expect(row.deleted_at).toBeNull();
    }
  }, 30_000);

  test("get returns full effective row shape incl. provider + multi-turn columns", async () => {
    const store = createCampaignStore(admin, tenantA);
    const id = await seedCampaign(tenantA);

    const row = await store.get(id);

    expect(row).not.toBeNull();
    const keys = Object.keys(row as object);
    for (const col of ALL_CAMPAIGN_COLUMNS) {
      expect(keys).toContain(col);
    }
    expect(keys.sort()).toEqual([...ALL_CAMPAIGN_COLUMNS].sort());
    expect((row as Record<string, unknown>).deleted_at).toBeNull();
    // Multi-turn guard defaults present (10/120/50/60).
    expect((row as Record<string, unknown>).max_conversation_turns).toBe(10);
    expect((row as Record<string, unknown>).no_reply_timeout_minutes).toBe(120);
    expect((row as Record<string, unknown>).max_sends_per_recipient).toBe(50);
    expect((row as Record<string, unknown>).global_send_rate_per_minute).toBe(60);
  }, 30_000);

  test("get returns null for unknown id and for soft-deleted id (no throw)", async () => {
    const store = createCampaignStore(admin, tenantA);

    await expect(store.get(randomUUID())).resolves.toBeNull();

    const deadId = await seedCampaign(tenantA, { deleted_at: new Date().toISOString() });
    await expect(store.get(deadId)).resolves.toBeNull();
  }, 30_000);
});

hosted("campaign store round-trip (VAL-CAMPAIGNS-002)", () => {
  test("create/update/softDelete round-trip", async () => {
    const store = createCampaignStore(admin, tenantA);

    // create — id returned, row visible through the store.
    const id = await store.create({
      name: `${MARKER}-roundtrip`,
      campaign_type: "sms",
      message_template: "Hi there",
    });
    expect(id).toBeTruthy();
    createdCampaignIds.push(id);
    const created = await store.get(id);
    expect(created?.name).toBe(`${MARKER}-roundtrip`);
    expect(created?.status).toBe("draft");
    const createdRaw = await readCampaignRow(id);
    const createdUpdatedAt = Date.parse(createdRaw.updated_at as string);

    // update — partial patch only; the DB trigger owns updated_at (the store
    // never sends it — payload parity proven in the unit tests).
    await sleep(60);
    await store.update(id, { status: "paused", settings: { batch: 3 } });
    const afterUpdate = await readCampaignRow(id);
    expect(afterUpdate.status).toBe("paused");
    expect(afterUpdate.settings).toEqual({ batch: 3 });
    expect(Date.parse(afterUpdate.updated_at as string)).toBeGreaterThan(createdUpdatedAt);

    // softDelete — row physically remains, disappears from list()/get().
    await store.softDelete(id);
    const raw = await readCampaignRow(id); // direct read: still exists
    expect(raw.deleted_at).not.toBeNull();
    expect(raw.status).toBe("cancelled");
    await expect(store.get(id)).resolves.toBeNull();
    const listed = await store.list();
    expect(listed.map((r) => r.id)).not.toContain(id);
  }, 60_000);
});

hosted("campaign store stats and recipients (VAL-CAMPAIGNS-003)", () => {
  test("getStats matches CampaignStats fields and counts", async () => {
    const campaignId = await seedCampaign(tenantA);
    const counts: Record<string, number> = {
      pending: 3,
      scheduled: 2,
      in_progress: 1,
      completed: 2,
      failed: 1,
      skipped: 1,
      opted_out: 1,
      no_answer: 1,
      voicemail: 1,
    };
    for (const [status, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        await seedRecipient(campaignId, tenantA, { status });
      }
    }

    // An unrecognized status cannot be seeded: campaign_recipients.status has
    // a CHECK constraint (the 9 recognized values), so Postgres rejects it
    // with 23514. The unknown-status tally path (total++ only) is therefore
    // covered by the unit test against the mocked client.
    const badInsert = await (admin.from("campaign_recipients") as any)
      .insert({
        campaign_id: campaignId,
        tenant_id: tenantA,
        first_name: "Valcamp",
        phone: `${MARKER}-p-bad`,
        status: "weird_custom_status",
      });
    expect(badInsert.error?.code).toBe("23514");

    const store = createCampaignStore(admin, tenantA);
    const stats = await store.getStats(campaignId);
    expect(stats).toEqual({
      total: 13,
      pending: 3,
      scheduled: 2,
      in_progress: 1,
      completed: 2,
      failed: 1,
      skipped: 1,
      opted_out: 1,
      no_answer: 1,
      voicemail: 1,
    });
  }, 60_000);

  test("listRecipients honors status/limit/offset with the 13-column projection", async () => {
    const campaignId = await seedCampaign(tenantA);
    // 5 recipients with strictly-decreasing created_at so ordering/pagination
    // are deterministic: r5 newest … r1 oldest.
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      ids.push(
        await seedRecipient(campaignId, tenantA, {
          status: i <= 2 ? "pending" : "completed",
          created_at: new Date(Date.parse("2026-01-01T12:00:00Z") + i * 3_600_000).toISOString(),
        }),
      );
    }
    const byNewest = [...ids].reverse(); // created_at DESC

    const store = createCampaignStore(admin, tenantA);

    const all = await store.listRecipients(campaignId);
    expect(all.map((r) => r.id)).toEqual(byNewest);
    for (const row of all) {
      expect(Object.keys(row).sort()).toEqual([...RECIPIENT_PROJECTION_COLUMNS].sort());
    }

    const pending = await store.listRecipients(campaignId, { status: "pending" });
    expect(pending.map((r) => r.id).sort()).toEqual([...ids.slice(0, 2)].sort());
    expect(pending.every((r) => r.status === "pending")).toBe(true);

    const page = await store.listRecipients(campaignId, { limit: 2, offset: 1 });
    expect(page.map((r) => r.id)).toEqual([byNewest[1], byNewest[2]]);
  }, 60_000);

  test("getRecipientTimezoneStats buckets unknown timezones", async () => {
    const campaignId = await seedCampaign(tenantA);
    await seedRecipient(campaignId, tenantA, { timezone: "America/New_York" });
    await seedRecipient(campaignId, tenantA, { timezone: "America/New_York" });
    await seedRecipient(campaignId, tenantA, { timezone: "Europe/London" });
    await seedRecipient(campaignId, tenantA, { timezone: null });
    await seedRecipient(campaignId, tenantA, { timezone: "" });

    const store = createCampaignStore(admin, tenantA);
    const counts = await store.getRecipientTimezoneStats(campaignId);
    expect(counts).toEqual({
      "America/New_York": 2,
      "Europe/London": 1,
      Unknown: 2,
    });
  }, 60_000);
});

hosted("campaign store tenant isolation (VAL-CAMPAIGNS-010)", () => {
  test("cross-tenant: list omits B's rows; get/update/softDelete on B's id are no-ops", async () => {
    const storeA = createCampaignStore(admin, tenantA);
    const ownId = await seedCampaign(tenantA, { name: `${MARKER}-own-a` });
    const foreignId = await seedCampaign(tenantB, { name: `${MARKER}-foreign-b` });
    const foreignBefore = await readCampaignRow(foreignId);

    // list() for A omits B's rows.
    const rowsA = await storeA.list();
    expect(rowsA.map((r) => r.id)).not.toContain(foreignId);
    expect(rowsA.map((r) => r.id)).toContain(ownId);

    // get(bId) → null.
    await expect(storeA.get(foreignId)).resolves.toBeNull();

    // update through A's store on B's id: zero-row no-op, byte-identical row.
    await expect(storeA.update(foreignId, { name: "hijacked" })).resolves.toBeUndefined();
    expect(await readCampaignRow(foreignId)).toEqual(foreignBefore);

    // softDelete through A's store on B's id: zero-row no-op too.
    await expect(storeA.softDelete(foreignId)).resolves.toBeUndefined();
    expect(await readCampaignRow(foreignId)).toEqual(foreignBefore);
  }, 60_000);
});
