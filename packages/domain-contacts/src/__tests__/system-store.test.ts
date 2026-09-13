/**
 * Payload-parity tests for the system-tier contacts store
 * (VAL-CONTACTS-006/007/008/009/010/011/018).
 *
 * Every assertion is pinned to a cataloged writer payload in
 * `docs/superpowers/research/2026-09-13-crm-schema-ground-truth.md`:
 * - W1/W2/W3 identity-resolver.ts (channel-match reuse, phone-reuse
 *   contact_channels upsert, auto-create placeholder names)
 * - W12/W13/W14 suppression-subscriber.ts (per-kind column sets, soft-bounce
 *   no-write, email-lookup re-emit)
 * - W15 db-client.ts setContactSmsOptOut (minus the redundant updated_at)
 * - W16 conversation-service.ts appendMessage aggregate touch
 * - "Adjacent write" crm-sync-service.ts sync_state upsert/read + contact
 *   projection read.
 */
import { describe, expect, test, vi } from "vitest";
import { createSystemContactsStore } from "../system-store.js";
import { TenantIdRequiredError } from "../errors.js";
import { createMockSupabase } from "./helpers/mock-supabase.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("system store", () => {
  // ── resolveChannelIdentity — W3 create path ─────────────────────────────

  test("resolveChannelIdentity creates contact + primary channel with placeholder convention (sms and email)", async () => {
    // sms: channel lookup miss → phone-reuse lookup miss → contacts insert →
    // contact_channels insert.
    const sms = createMockSupabase([
      { data: null }, // contact_channels lookup (W1 miss)
      { data: null }, // phone-reuse lookup (W2 miss — sms is a phone channel)
      { data: { id: "c-new" } }, // contacts insert .select("id").single()
      {}, // contact_channels insert (awaited builder)
    ]);
    const smsStore = createSystemContactsStore(sms.client);

    const smsResult = await smsStore.resolveChannelIdentity({
      tenantId: TENANT,
      channel: "sms",
      address: "+1 (555) 123-4567",
    });

    expect(smsResult).toEqual({ contactId: "c-new", isNew: true });
    expect(sms.calls).toEqual([
      { op: "from", args: ["contact_channels"] },
      { op: "select", args: ["contact_id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["channel", "sms"] },
      { op: "eq", args: ["normalized_address", "+15551234567"] },
      { op: "maybeSingle", args: [] },
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "or", args: ["phone.eq.+15551234567,phone_e164.eq.+15551234567"] },
      { op: "limit", args: [1] },
      { op: "maybeSingle", args: [] },
      { op: "from", args: ["contacts"] },
      {
        op: "insert",
        args: [
          {
            first_name: "Contact",
            last_name: "+15551234567",
            phone: "+15551234567",
            phone_e164: "+15551234567",
            last_inbound_at: expect.any(String),
            last_contacted_at: expect.any(String),
            tenant_id: TENANT,
          },
        ],
      },
      { op: "select", args: ["id"] },
      { op: "single", args: [] },
      { op: "from", args: ["contact_channels"] },
      {
        op: "insert",
        args: [
          {
            tenant_id: TENANT,
            contact_id: "c-new",
            channel: "sms",
            address: "+1 (555) 123-4567",
            normalized_address: "+15551234567",
            is_primary: true,
          },
        ],
      },
    ]);

    // email: lowercase normalization; last_name carries the raw address (W3
    // buildContactRow email branch), email carries the normalized one.
    const email = createMockSupabase([
      { data: null }, // contact_channels lookup miss
      { data: { id: "c-email" } },
      {},
    ]);
    const emailStore = createSystemContactsStore(email.client);

    const emailResult = await emailStore.resolveChannelIdentity({
      tenantId: TENANT,
      channel: "email",
      address: "Alice@Example.COM",
    });

    expect(emailResult).toEqual({ contactId: "c-email", isNew: true });
    expect(email.calls).toEqual([
      { op: "from", args: ["contact_channels"] },
      { op: "select", args: ["contact_id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["channel", "email"] },
      { op: "eq", args: ["normalized_address", "alice@example.com"] },
      { op: "maybeSingle", args: [] },
      { op: "from", args: ["contacts"] },
      {
        op: "insert",
        args: [
          {
            first_name: "Contact",
            last_name: "Alice@Example.COM",
            email: "alice@example.com",
            last_inbound_at: expect.any(String),
            last_contacted_at: expect.any(String),
            tenant_id: TENANT,
          },
        ],
      },
      { op: "select", args: ["id"] },
      { op: "single", args: [] },
      { op: "from", args: ["contact_channels"] },
      {
        op: "insert",
        args: [
          {
            tenant_id: TENANT,
            contact_id: "c-email",
            channel: "email",
            address: "Alice@Example.COM",
            normalized_address: "alice@example.com",
            is_primary: true,
          },
        ],
      },
    ]);
  });

  test("resolveChannelIdentity normalizes whatsapp ids by stripping the @ prefix", async () => {
    const { client, calls } = createMockSupabase([
      { data: null }, // channel lookup miss
      { data: null }, // phone-reuse lookup miss
      { data: { id: "c-wa" } },
      {},
    ]);

    const result = await createSystemContactsStore(client).resolveChannelIdentity({
      tenantId: TENANT,
      channel: "whatsapp",
      address: "@+15551234567",
    });

    expect(result).toEqual({ contactId: "c-wa", isNew: true });
    expect(calls[4]).toEqual({ op: "eq", args: ["normalized_address", "+15551234567"] });
  });

  // ── resolveChannelIdentity — W1/W2 reuse paths ──────────────────────────

  test("resolveChannelIdentity reuses contact on channel match and ignoreDuplicates-upserts on phone reuse", async () => {
    // W1: existing contact_channels row wins — only last_inbound_at is written.
    const w1 = createMockSupabase([
      { data: { contact_id: "c-9" } }, // channel lookup hit
      {}, // contacts update (awaited builder)
    ]);

    const w1Result = await createSystemContactsStore(w1.client).resolveChannelIdentity({
      tenantId: TENANT,
      channel: "sms",
      address: "+15551234567",
    });

    expect(w1Result).toEqual({ contactId: "c-9", isNew: false });
    expect(w1.calls).toEqual([
      { op: "from", args: ["contact_channels"] },
      { op: "select", args: ["contact_id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["channel", "sms"] },
      { op: "eq", args: ["normalized_address", "+15551234567"] },
      { op: "maybeSingle", args: [] },
      { op: "from", args: ["contacts"] },
      { op: "update", args: [{ last_inbound_at: expect.any(String) }] },
      { op: "eq", args: ["id", "c-9"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);

    // W2: same phone under another channel — reuse the contact, upsert the
    // channel row with ignoreDuplicates so a pre-existing row keeps its
    // original contact_id, then touch last_inbound_at.
    const w2 = createMockSupabase([
      { data: null }, // channel lookup miss
      { data: { id: "c-7" } }, // phone lookup hit
      {}, // contact_channels upsert (awaited builder)
      {}, // contacts update (awaited builder)
    ]);

    const w2Result = await createSystemContactsStore(w2.client).resolveChannelIdentity({
      tenantId: TENANT,
      channel: "whatsapp",
      address: "+15551234567",
    });

    expect(w2Result).toEqual({ contactId: "c-7", isNew: false });
    expect(w2.calls).toEqual([
      { op: "from", args: ["contact_channels"] },
      { op: "select", args: ["contact_id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["channel", "whatsapp"] },
      { op: "eq", args: ["normalized_address", "+15551234567"] },
      { op: "maybeSingle", args: [] },
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "or", args: ["phone.eq.+15551234567,phone_e164.eq.+15551234567"] },
      { op: "limit", args: [1] },
      { op: "maybeSingle", args: [] },
      { op: "from", args: ["contact_channels"] },
      {
        op: "upsert",
        args: [
          {
            tenant_id: TENANT,
            contact_id: "c-7",
            channel: "whatsapp",
            address: "+15551234567",
            normalized_address: "+15551234567",
            is_primary: false,
          },
          { onConflict: "tenant_id,channel,normalized_address", ignoreDuplicates: true },
        ],
      },
      { op: "from", args: ["contacts"] },
      { op: "update", args: [{ last_inbound_at: expect.any(String) }] },
      { op: "eq", args: ["id", "c-7"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);

    // Email channel never takes the phone-reuse path.
    const emailNoPhone = createMockSupabase([
      { data: null }, // channel lookup miss
      { data: { id: "c-e2" } },
      {},
    ]);
    await createSystemContactsStore(emailNoPhone.client).resolveChannelIdentity({
      tenantId: TENANT,
      channel: "email",
      address: "bob@example.com",
    });
    expect(emailNoPhone.calls.some((c) => c.op === "or")).toBe(false);
  });

  test("resolveChannelIdentity rethrows insert failures with the W3 message", async () => {
    const { client } = createMockSupabase([
      { data: null }, // channel lookup miss
      { data: null }, // phone-reuse lookup miss
      { data: null, error: { message: "boom" } }, // contacts insert fails
    ]);

    await expect(
      createSystemContactsStore(client).resolveChannelIdentity({
        tenantId: TENANT,
        channel: "sms",
        address: "+15551234567",
      }),
    ).rejects.toThrow("Failed to create contact for sms address: boom");
  });

  // ── touchActivity — W1/W2/W16 ───────────────────────────────────────────

  test("touchActivity sets activity timestamps only (never updated_at)", async () => {
    // W16 shape: both columns.
    const w16 = createMockSupabase([{}]);
    await createSystemContactsStore(w16.client).touchActivity({
      tenantId: TENANT,
      contactId: "c-1",
      lastInboundAt: "2026-09-13T10:00:00.000Z",
      lastContactedAt: "2026-09-13T10:00:01.000Z",
    });
    expect(w16.calls).toEqual([
      { op: "from", args: ["contacts"] },
      {
        op: "update",
        args: [{ last_inbound_at: "2026-09-13T10:00:00.000Z", last_contacted_at: "2026-09-13T10:00:01.000Z" }],
      },
      { op: "eq", args: ["id", "c-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);

    // W1/W2 shape: last_inbound_at only (defaults to now).
    const w1 = createMockSupabase([{}]);
    await createSystemContactsStore(w1.client).touchActivity({
      tenantId: TENANT,
      contactId: "c-1",
    });
    expect(w1.calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "update", args: [{ last_inbound_at: expect.any(String) }] },
      { op: "eq", args: ["id", "c-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);
  });

  // ── setSmsOptOut — W15 minus redundant updated_at ───────────────────────

  test("setSmsOptOut sets sms_opt_out without manual updated_at", async () => {
    const { client, calls } = createMockSupabase([{}]);

    await createSystemContactsStore(client).setSmsOptOut({
      tenantId: TENANT,
      contactId: "c-1",
      optOut: true,
    });

    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "update", args: [{ sms_opt_out: true }] },
      { op: "eq", args: ["id", "c-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);
  });

  // ── suppressEmail — W12/W13/W14 ─────────────────────────────────────────

  test("suppressEmail unsubscribe sets email_opt_out only", async () => {
    const { client, calls } = createMockSupabase([{}]);

    await createSystemContactsStore(client).suppressEmail({
      tenantId: TENANT,
      contactId: "c-1",
      kind: "unsubscribe",
    });

    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "update", args: [{ email_opt_out: true }] },
      { op: "eq", args: ["id", "c-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);
  });

  test("suppressEmail hard-bounce sets email_opt_out + email_valid=false", async () => {
    const { client, calls } = createMockSupabase([{}]);

    await createSystemContactsStore(client).suppressEmail({
      tenantId: TENANT,
      contactId: "c-1",
      kind: "hard-bounce",
    });

    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "update", args: [{ email_opt_out: true, email_valid: false }] },
      { op: "eq", args: ["id", "c-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);
  });

  test("suppressEmail soft-bounce writes nothing", async () => {
    const { client, calls } = createMockSupabase();

    await createSystemContactsStore(client).suppressEmail({
      tenantId: TENANT,
      contactId: "c-1",
      kind: "soft-bounce",
    });

    expect(calls).toEqual([]);
  });

  test("suppressEmail never auto-clears email_opt_out (monotonic)", async () => {
    const { client, calls } = createMockSupabase([{}, {}]);
    const store = createSystemContactsStore(client);

    await store.suppressEmail({ tenantId: TENANT, contactId: "c-1", kind: "unsubscribe" });
    await store.suppressEmail({ tenantId: TENANT, contactId: "c-1", kind: "hard-bounce" });
    await store.suppressEmail({ tenantId: TENANT, contactId: "c-1", kind: "unsubscribe" });

    // Every write payload only ever sets the flags toward suppression —
    // no path writes email_opt_out: false or email_valid: true.
    const patches = calls.filter((c) => c.op === "update").map((c) => c.args[0]);
    expect(patches).toEqual([
      { email_opt_out: true },
      { email_opt_out: true, email_valid: false },
      { email_opt_out: true },
    ]);
  });

  test("suppressEmail email-lookup resolves contactId and re-emits contact.unsubscribed", async () => {
    const { client, calls } = createMockSupabase([
      { data: { id: "c-5" } }, // tenant+email lookup hit
      {}, // contacts update (awaited builder)
    ]);
    const emit = vi.fn().mockResolvedValue(undefined);
    const store = createSystemContactsStore(client, { emit });

    await store.suppressEmail({
      tenantId: TENANT,
      email: "unsub@example.com",
      kind: "unsubscribe",
      idempotencyKey: "evt-1",
    });

    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["email", "unsub@example.com"] },
      { op: "maybeSingle", args: [] },
      { op: "from", args: ["contacts"] },
      { op: "update", args: [{ email_opt_out: true }] },
      { op: "eq", args: ["id", "c-5"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("contact.unsubscribed", {
      idempotencyKey: "evt-1-resolved",
      actor: { type: "system" },
      refs: { tenantId: TENANT, contactId: "c-5" },
      data: { email: "unsub@example.com", channel: "email" },
    });
  });

  test("suppressEmail email-lookup unmatched email: no write, no event", async () => {
    const { client, calls } = createMockSupabase([{ data: null }]);
    const emit = vi.fn();
    const store = createSystemContactsStore(client, { emit });

    await store.suppressEmail({ tenantId: TENANT, email: "ghost@example.com", kind: "unsubscribe" });

    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["email", "ghost@example.com"] },
      { op: "maybeSingle", args: [] },
    ]);
    expect(emit).not.toHaveBeenCalled();
  });

  test("suppressEmail hard-bounce via email lookup does not re-emit (W14 has no re-emit)", async () => {
    const { client } = createMockSupabase([
      { data: { id: "c-6" } },
      {},
    ]);
    const emit = vi.fn();
    const store = createSystemContactsStore(client, { emit });

    await store.suppressEmail({ tenantId: TENANT, email: "bounced@example.com", kind: "hard-bounce" });

    expect(emit).not.toHaveBeenCalled();
  });

  // ── tenantId hardening — VAL-CONTACTS-011 ───────────────────────────────

  test("tenantId required: rejects every method call without tenantId", async () => {
    const { client } = createMockSupabase();
    const store = createSystemContactsStore(client);

    // Compile-level proof: each call below omits tenantId and must fail
    // type-check (these @ts-expect-error directives would themselves error
    // if the omission were allowed).
    const unchecked: Promise<unknown>[] = [
      // @ts-expect-error tenantId is required
      store.resolveChannelIdentity({ channel: "sms", address: "+15551234567" }),
      // @ts-expect-error tenantId is required
      store.touchActivity({ contactId: "c-1" }),
      // @ts-expect-error tenantId is required
      store.suppressEmail({ contactId: "c-1", kind: "unsubscribe" }),
      // @ts-expect-error tenantId is required
      store.setSmsOptOut({ contactId: "c-1", optOut: true }),
      // @ts-expect-error tenantId is required
      store.getSyncProjection({ contactId: "c-1" }),
      // @ts-expect-error tenantId is required
      store.getSyncState({ entityId: "c-1" }),
      // @ts-expect-error tenantId is required
      store.saveSyncState({ entityId: "c-1", metadata: { hash: "x" } }),
    ];
    for (const call of unchecked) {
      await expect(call).rejects.toBeInstanceOf(TenantIdRequiredError);
    }

    // Runtime proof with empty-string tenantId.
    await expect(
      store.resolveChannelIdentity({ tenantId: "", channel: "sms", address: "+15551234567" }),
    ).rejects.toBeInstanceOf(TenantIdRequiredError);
    await expect(store.touchActivity({ tenantId: "", contactId: "c-1" })).rejects.toBeInstanceOf(
      TenantIdRequiredError,
    );
    await expect(
      store.suppressEmail({ tenantId: "", contactId: "c-1", kind: "unsubscribe" }),
    ).rejects.toBeInstanceOf(TenantIdRequiredError);
    await expect(
      store.setSmsOptOut({ tenantId: "", contactId: "c-1", optOut: true }),
    ).rejects.toBeInstanceOf(TenantIdRequiredError);
    await expect(store.getSyncProjection({ tenantId: "", contactId: "c-1" })).rejects.toBeInstanceOf(
      TenantIdRequiredError,
    );
    await expect(store.getSyncState({ tenantId: "", entityId: "c-1" })).rejects.toBeInstanceOf(
      TenantIdRequiredError,
    );
    await expect(
      store.saveSyncState({ tenantId: "", entityId: "c-1", metadata: {} }),
    ).rejects.toBeInstanceOf(TenantIdRequiredError);
  });

  test("injection-only: the store module never constructs a client or reads the service-role key", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../system-store.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toContain("admin-client");
    expect(source).not.toContain("createAdminClient");
    expect(source).not.toContain("createClient");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  // ── Brevo sync policy — crm-sync-service read/upsert sites ──────────────

  test("getSyncProjection returns cataloged ContactProjection fields", async () => {
    const contactRow = {
      id: "c-1",
      tenant_id: TENANT,
      email: "ada@example.com",
      phone: "+15551234567",
      first_name: "Ada",
      last_name: "Lovelace",
      custom_fields: { vip: true, count: 3, skip: { nested: true } },
      sms_opt_out: false,
    };
    const { client, calls } = createMockSupabase([{ data: contactRow }]);

    const projection = await createSystemContactsStore(client).getSyncProjection({
      tenantId: TENANT,
      contactId: "c-1",
      action: {
        setAttributes: { email_opt_out: true, SOURCE: "campaign" },
        listAdd: ["newsletter", "vip"],
        listRemove: ["trial"],
        setLifecycleStage: "customer",
      },
    });

    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["*"] },
      { op: "eq", args: ["id", "c-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "maybeSingle", args: [] },
    ]);

    expect(projection).toEqual({
      konnectContactId: "c-1",
      tenantId: TENANT,
      email: "ada@example.com",
      phone: "+15551234567",
      firstName: "Ada",
      lastName: "Lovelace",
      attributes: { email_opt_out: true, SOURCE: "campaign", vip: true, count: 3 },
      lifecycleStage: "customer",
      score: undefined,
      listKeys: ["newsletter", "vip"],
      removeListKeys: ["trial"],
      emailOptOut: true,
      smsOptOut: false,
    });
  });

  test("getSyncProjection returns null for a missing contact (skip-as-noop)", async () => {
    const { client } = createMockSupabase([{ data: null }]);

    const projection = await createSystemContactsStore(client).getSyncProjection({
      tenantId: TENANT,
      contactId: "ghost",
    });

    expect(projection).toBeNull();
  });

  test("saveSyncState upsert-no-duplicate payload parity (Adjacent write)", async () => {
    const { client, calls } = createMockSupabase([{}]);

    await createSystemContactsStore(client).saveSyncState({
      tenantId: TENANT,
      entityId: "c-1",
      metadata: { hash: "abc123", brevoId: "brevo-9" },
    });

    expect(calls).toEqual([
      { op: "from", args: ["sync_state"] },
      {
        op: "upsert",
        args: [
          {
            tenant_id: TENANT,
            entity_type: "contact",
            entity_id: "c-1",
            provider_slug: "brevo",
            last_synced_at: expect.any(String),
            last_sync_direction: "out",
            conflict_flag: false,
            metadata: { hash: "abc123", brevoId: "brevo-9" },
          },
          { onConflict: "entity_type, entity_id, provider_slug" },
        ],
      },
    ]);
  });

  test("getSyncState read parity + metadata round-trip shape", async () => {
    const syncRow = {
      id: "s-1",
      tenant_id: TENANT,
      entity_type: "contact",
      entity_id: "c-1",
      provider_slug: "brevo",
      last_synced_at: "2026-09-13T10:00:00.000Z",
      last_sync_direction: "out",
      conflict_flag: false,
      metadata: { hash: "abc123", brevoId: "brevo-9" },
      created_at: "2026-09-13T09:00:00.000Z",
      updated_at: "2026-09-13T10:00:00.000Z",
    };
    const { client, calls } = createMockSupabase([{ data: syncRow }]);

    const state = await createSystemContactsStore(client).getSyncState({
      tenantId: TENANT,
      entityId: "c-1",
    });

    expect(calls).toEqual([
      { op: "from", args: ["sync_state"] },
      { op: "select", args: ["*"] },
      { op: "eq", args: ["entity_type", "contact"] },
      { op: "eq", args: ["entity_id", "c-1"] },
      { op: "eq", args: ["provider_slug", "brevo"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "maybeSingle", args: [] },
    ]);
    expect(state).toEqual(syncRow);
    expect(state?.metadata).toEqual({ hash: "abc123", brevoId: "brevo-9" });
  });

  test("getSyncState returns null when no state row exists", async () => {
    const { client } = createMockSupabase([{ data: null }]);

    const state = await createSystemContactsStore(client).getSyncState({
      tenantId: TENANT,
      entityId: "c-none",
      providerSlug: "hubspot",
    });

    expect(state).toBeNull();
  });
});
