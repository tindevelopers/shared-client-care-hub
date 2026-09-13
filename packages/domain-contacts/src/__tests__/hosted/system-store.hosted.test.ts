/**
 * Hosted-Supabase integration tests for the system-tier contacts store
 * (VAL-CONTACTS-006/007/008/009/010/018).
 *
 * Rules honored (mission AGENTS.md):
 * - HOSTED Supabase only (`sfdhtsfvkticvqjqdvud.supabase.co`); keys come from
 *   the hub `.env` (gitignored) and are never printed.
 * - Every row this suite touches is created by the suite, marked with the
 *   `crm-val-<marker>` prefix, and deleted in afterAll; existing hosted data
 *   is read-only (the only pre-existing read is the tenant id required by the
 *   contacts.tenant_id FK).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSystemContactsStore } from "../../system-store.js";

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
    "[hosted] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — system-store hosted integration tests SKIPPED (loudly)",
  );
}

/** Unique-per-run marker; every created row carries it so cleanup is precise. */
const MARKER = `crm-val-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

let admin: SupabaseClient;
let tenantId = "";
const createdContactIds: string[] = [];

async function readContact(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await (admin.from("contacts") as any).select("*").eq("id", id).single();
  if (error) throw new Error(`readContact failed: ${error.message}`);
  return data as Record<string, unknown>;
}

async function channelRows(normalized: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await (admin.from("contact_channels") as any)
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("normalized_address", normalized);
  if (error) throw new Error(`channelRows failed: ${error.message}`);
  return (data as Array<Record<string, unknown>>) ?? [];
}

async function seedContact(overrides: Record<string, unknown> = {}): Promise<string> {
  const email = `${MARKER}-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await (admin.from("contacts") as any)
    .insert({ tenant_id: tenantId, first_name: "Val", last_name: "Sys", email, ...overrides })
    .select("id")
    .single();
  if (error) throw new Error(`seedContact failed: ${error.message}`);
  createdContactIds.push(data.id as string);
  return data.id as string;
}

/** Columns that may legitimately differ between two full reads of one row. */
function diffRows(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  allowed: string[],
): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(before)) {
    if (allowed.includes(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  return changed;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: tenants, error } = await (admin.from("tenants") as any).select("id").order("created_at").limit(1);
  if (error) throw new Error(`tenant fetch failed: ${error.message}`);
  if (!tenants || tenants.length < 1) throw new Error("[hosted] need at least one tenant");
  tenantId = tenants[0].id as string;
}, 30_000);

afterAll(async () => {
  let deletedContacts = 0;
  let deletedSyncStates = 0;
  if (createdContactIds.length > 0) {
    // sync_state rows reference our test contacts as entity_id — delete first.
    const { data: syncRows } = await (admin.from("sync_state") as any)
      .delete()
      .in("entity_id", createdContactIds)
      .select("id");
    deletedSyncStates = syncRows?.length ?? 0;
    // Channels are deleted explicitly (safe whether or not the FK cascades).
    await (admin.from("contact_channels") as any).delete().in("contact_id", createdContactIds);
    const { data: contacts } = await (admin.from("contacts") as any)
      .delete()
      .in("id", createdContactIds)
      .select("id");
    deletedContacts = contacts?.length ?? 0;
  }
  // Belt and braces, marker-precise (never a broad crm-val-% sweep).
  await (admin.from("contacts") as any).delete().like("email", `${MARKER}%`);
  const { count } = await (admin.from("contacts") as any)
    .select("id", { count: "exact", head: true })
    .like("email", `${MARKER}%`);
  console.log(
    `cleanup: deleted ${deletedContacts} test contacts and ${deletedSyncStates} test sync_state rows; leftover ${MARKER} rows: ${count ?? "?"}`,
  );
  expect(count ?? 0).toBe(0);
}, 30_000);

hosted("system store resolveChannelIdentity creates", () => {
  test("creates contact + primary channel with placeholder convention (sms and email)", async () => {
    const store = createSystemContactsStore(admin);
    const smsAddress = `+1555${Date.now().toString().slice(-7)}`;
    const result = await store.resolveChannelIdentity({ tenantId, channel: "sms", address: smsAddress });
    createdContactIds.push(result.contactId);
    expect(result.isNew).toBe(true);

    const contact = await readContact(result.contactId);
    expect(contact.first_name).toBe("Contact");
    expect(contact.last_name).toBe(smsAddress);
    expect(contact.phone).toBe(smsAddress);
    expect(contact.phone_e164).toBe(smsAddress);
    expect(contact.last_inbound_at).toBeTruthy();
    expect(contact.last_contacted_at).toBeTruthy();

    const channels = await channelRows(smsAddress);
    expect(channels).toHaveLength(1);
    expect(channels[0].channel).toBe("sms");
    expect(channels[0].is_primary).toBe(true);
    expect(channels[0].contact_id).toBe(result.contactId);

    // Email variant: lowercased email; email column set, no phone fields.
    const emailLocal = `${MARKER}-identity-${randomUUID().slice(0, 6)}`;
    const emailResult = await store.resolveChannelIdentity({
      tenantId,
      channel: "email",
      address: `${emailLocal}@Example.COM`,
    });
    createdContactIds.push(emailResult.contactId);
    expect(emailResult.isNew).toBe(true);
    const emailContact = await readContact(emailResult.contactId);
    expect(emailContact.first_name).toBe("Contact");
    expect(emailContact.email).toBe(`${emailLocal}@example.com`);
    expect(emailContact.phone).toBeNull();
    expect(emailContact.phone_e164).toBeNull();
    const emailChannels = await channelRows(`${emailLocal}@example.com`);
    expect(emailChannels).toHaveLength(1);
    expect(emailChannels[0].channel).toBe("email");
    expect(emailChannels[0].is_primary).toBe(true);
  }, 60_000);
});

hosted("system store resolveChannelIdentity reuse", () => {
  test("reuses contact on channel match and ignoreDuplicates-upserts on phone reuse", async () => {
    const store = createSystemContactsStore(admin);
    const phone = `+1555${Date.now().toString().slice(-7)}`;

    // First sms resolve creates contact A + primary sms channel.
    const first = await store.resolveChannelIdentity({ tenantId, channel: "sms", address: phone });
    createdContactIds.push(first.contactId);
    expect(first.isNew).toBe(true);

    // Same channel + address again → channel match reuse, no new rows.
    const again = await store.resolveChannelIdentity({ tenantId, channel: "sms", address: phone });
    expect(again).toEqual({ contactId: first.contactId, isNew: false });
    expect(await channelRows(phone)).toHaveLength(1);

    // Same phone under whatsapp → phone-reuse: same contact, new non-primary
    // channel row via onConflict+ignoreDuplicates upsert, no error.
    const viaWa = await store.resolveChannelIdentity({ tenantId, channel: "whatsapp", address: phone });
    expect(viaWa).toEqual({ contactId: first.contactId, isNew: false });

    const channels = await channelRows(phone);
    expect(channels).toHaveLength(2);
    const smsRow = channels.find((c) => c.channel === "sms");
    const waRow = channels.find((c) => c.channel === "whatsapp");
    // The pre-existing (sms) channel row keeps its original contact_id.
    expect(smsRow?.contact_id).toBe(first.contactId);
    expect(smsRow?.is_primary).toBe(true);
    expect(waRow?.contact_id).toBe(first.contactId);
    expect(waRow?.is_primary).toBe(false);

    // Exactly one contact carries this phone (no duplicates created).
    const { count } = await (admin.from("contacts") as any)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("phone", phone);
    expect(count).toBe(1);
  }, 60_000);
});

hosted("system store touchActivity / setSmsOptOut", () => {
  test("touchActivity sets activity timestamps only; setSmsOptOut sets sms_opt_out without manual updated_at", async () => {
    const store = createSystemContactsStore(admin);
    const contactId = await seedContact({ last_inbound_at: null, last_contacted_at: null, sms_opt_out: false });
    const before = await readContact(contactId);

    await store.touchActivity({
      tenantId,
      contactId,
      lastInboundAt: "2026-09-13T10:00:00.000Z",
      lastContactedAt: "2026-09-13T10:00:01.000Z",
    });
    const after = await readContact(contactId);
    // PostgREST renders timestamptz as "+00:00"; compare instants.
    expect(new Date(after.last_inbound_at as string).toISOString()).toBe("2026-09-13T10:00:00.000Z");
    expect(new Date(after.last_contacted_at as string).toISOString()).toBe("2026-09-13T10:00:01.000Z");
    expect(diffRows(before, after, ["last_inbound_at", "last_contacted_at", "updated_at"])).toEqual([]);
    // updated_at is trigger-owned: it advanced without the store sending it.
    expect(new Date(after.updated_at as string).getTime()).toBeGreaterThanOrEqual(
      new Date(before.updated_at as string).getTime(),
    );

    await store.setSmsOptOut({ tenantId, contactId, optOut: true });
    const afterOptOut = await readContact(contactId);
    expect(afterOptOut.sms_opt_out).toBe(true);
    expect(diffRows(after, afterOptOut, ["sms_opt_out", "updated_at"])).toEqual([]);
  }, 60_000);
});

hosted("system store suppressEmail", () => {
  test("per-kind column semantics, soft-bounce no-write, monotonic", async () => {
    const store = createSystemContactsStore(admin);

    const unsub = await seedContact({ email_opt_out: false, email_valid: true });
    await store.suppressEmail({ tenantId, contactId: unsub, kind: "unsubscribe" });
    let row = await readContact(unsub);
    expect(row.email_opt_out).toBe(true);
    expect(row.email_valid).toBe(true);

    const hard = await seedContact({ email_opt_out: false, email_valid: true });
    await store.suppressEmail({ tenantId, contactId: hard, kind: "hard-bounce" });
    row = await readContact(hard);
    expect(row.email_opt_out).toBe(true);
    expect(row.email_valid).toBe(false);

    // Soft bounce: no write at all — row stays byte-identical (updated_at too).
    const soft = await seedContact({ email_opt_out: false, email_valid: true });
    const softBefore = await readContact(soft);
    await store.suppressEmail({ tenantId, contactId: soft, kind: "soft-bounce" });
    expect(await readContact(soft)).toEqual(softBefore);

    // Monotonic: a later unsubscribe never clears flags set by a hard bounce.
    await store.suppressEmail({ tenantId, contactId: hard, kind: "unsubscribe" });
    row = await readContact(hard);
    expect(row.email_opt_out).toBe(true);
    expect(row.email_valid).toBe(false);
  }, 60_000);

  test("email-lookup resolves contactId and re-emits contact.unsubscribed", async () => {
    const email = `${MARKER}-lookup-${randomUUID().slice(0, 6)}@example.com`;
    const contactId = await seedContact({ email, email_opt_out: false });
    const emit = vi.fn().mockResolvedValue(undefined);
    const store = createSystemContactsStore(admin, { emit });

    await store.suppressEmail({ tenantId, email, kind: "unsubscribe", idempotencyKey: "evt-42" });

    const row = await readContact(contactId);
    expect(row.email_opt_out).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
    const [type, envelope] = emit.mock.calls[0] as [string, Record<string, unknown>];
    expect(type).toBe("contact.unsubscribed");
    expect(envelope.refs).toEqual({ tenantId, contactId });
    expect(envelope.data).toEqual({ email, channel: "email" });
    expect(envelope.idempotencyKey).toBe("evt-42-resolved");

    // Unmatched email: no write, no event.
    const ghostEmit = vi.fn();
    const ghostStore = createSystemContactsStore(admin, { emit: ghostEmit });
    await ghostStore.suppressEmail({
      tenantId,
      email: `${MARKER}-ghost@example.com`,
      kind: "unsubscribe",
    });
    expect(ghostEmit).not.toHaveBeenCalled();
  }, 60_000);
});

hosted("system store sync state", () => {
  test("saveSyncState upserts without duplicating; getSyncState round-trips metadata", async () => {
    const store = createSystemContactsStore(admin);
    const contactId = await seedContact();

    await store.saveSyncState({
      tenantId,
      entityId: contactId,
      metadata: { hash: "hash-one", brevoId: "brevo-1" },
      lastSyncedAt: "2026-09-13T10:00:00.000Z",
    });

    let state = await store.getSyncState({ tenantId, entityId: contactId });
    expect(state).not.toBeNull();
    expect(state?.entity_type).toBe("contact");
    expect(state?.provider_slug).toBe("brevo");
    expect(state?.last_sync_direction).toBe("out");
    expect(state?.conflict_flag).toBe(false);
    expect(state?.metadata).toEqual({ hash: "hash-one", brevoId: "brevo-1" });

    // Second save for the same entity → UPDATE, not a duplicate row.
    await store.saveSyncState({
      tenantId,
      entityId: contactId,
      metadata: { hash: "hash-two", brevoId: "brevo-2" },
      lastSyncedAt: "2026-09-13T11:00:00.000Z",
    });

    state = await store.getSyncState({ tenantId, entityId: contactId });
    expect(state?.metadata).toEqual({ hash: "hash-two", brevoId: "brevo-2" });
    // PostgREST renders timestamptz as "+00:00"; compare instants.
    expect(new Date(state?.last_synced_at as string).toISOString()).toBe("2026-09-13T11:00:00.000Z");

    const { count } = await (admin.from("sync_state") as any)
      .select("id", { count: "exact", head: true })
      .eq("entity_id", contactId)
      .eq("provider_slug", "brevo");
    expect(count).toBe(1);
  }, 60_000);

  test("getSyncProjection returns cataloged ContactProjection fields from a hosted row", async () => {
    const store = createSystemContactsStore(admin);
    const email = `${MARKER}-proj@example.com`;
    const contactId = await seedContact({
      email,
      phone: "+15550001111",
      custom_fields: { vip: true },
      sms_opt_out: true,
    });

    const projection = await store.getSyncProjection({ tenantId, contactId });
    expect(projection).toMatchObject({
      konnectContactId: contactId,
      tenantId,
      email,
      firstName: "Val",
      lastName: "Sys",
      attributes: { vip: true },
      listKeys: [],
      smsOptOut: true,
      emailOptOut: false,
    });
  }, 60_000);
});
