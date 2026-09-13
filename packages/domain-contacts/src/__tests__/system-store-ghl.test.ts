/**
 * Payload-parity tests for the GHL persistence tier of the system contacts
 * store — the domain-contacts implementation of adapter-kit's
 * ContactSyncPersistence seam (W20–W22).
 *
 * Every fixture is pinned to
 * `docs/superpowers/research/2026-09-13-crm-schema-ground-truth.md`:
 * - W20 — inbound update (matched row): custom_fields key-merge + ghl
 *   tracking columns + non-empty-wins scalars + explicit `updated_at`.
 * - W21 — inbound insert (no match): full insert column set.
 * - W22 — outbound write-back: ghl_contact_id / ghl_last_synced_at /
 *   merged custom_fields / updated_at, filtered by id + tenant_id.
 * - "Every W20–W22 is accompanied by a contact_sync_log insert" —
 *   appendSyncLog writes the 20260320100000 column set with synced_at.
 * - The outbound candidate listing is the legacy bulk listing
 *   (select * — tenant eq — range — order created_at asc), ported
 *   byte-for-byte from adapter-kit's default persistence.
 *
 * Hosted gap (2026-09-13): migration 20260320100000
 * (`contacts.ghl_contact_id` column + `contact_sync_log` table) is NOT
 * applied on the hosted project — a PostgREST probe returns 42703 for the
 * column and PGRST205 for the table. Per the feature note, hosted
 * integration tests for these methods are skipped until the migration
 * lands; these mocked-client unit tests are the publish gate.
 */
import { describe, expect, test } from "vitest";
import type {
  ContactSyncInboundInsert,
  ContactSyncInboundUpdate,
  ContactSyncPersistence,
  KonnectContact,
} from "@tindevelopers/adapter-kit/crm/providers/gohighlevel-contact-sync";
import { createSystemContactsStore } from "../system-store.js";
import { TenantIdRequiredError } from "../errors.js";
import { createMockSupabase } from "./helpers/mock-supabase.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

// ── W20 fixture: adapter-handed update payload (non-empty-wins scalars —
// empty GHL firstName omitted, non-empty lastName/phone applied; custom_fields
// key-merged: existing keys survive, ghl_contact_id + flattened GHL fields added).
const W20_UPDATE: ContactSyncInboundUpdate = {
  custom_fields: { existing_key: "keep", ghl_contact_id: "ghl-9", ext_key: "v1" },
  ghl_contact_id: "ghl-9",
  ghl_last_synced_at: "2026-09-13T10:00:00.000Z",
  last_name: "Doe",
  phone: "+15551234567",
  updated_at: "2026-09-13T10:00:01.000Z",
};

// ── W21 fixture: adapter-handed insert payload (no-match branch).
const W21_INSERT: ContactSyncInboundInsert = {
  tenant_id: TENANT,
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  phone: null,
  mobile: null,
  tags: null,
  custom_fields: { ghl_contact_id: "ghl-new" },
  ghl_contact_id: "ghl-new",
  ghl_last_synced_at: "2026-09-13T10:00:00.000Z",
};

function outboundRow(overrides: Partial<KonnectContact> = {}): KonnectContact {
  return {
    id: "kon-out-1",
    tenant_id: TENANT,
    first_name: "Jane",
    last_name: "Doe",
    email: "out@example.com",
    phone: "+15551234567",
    mobile: null,
    tags: ["vip"],
    custom_fields: { existing_key: "keep" },
    ghl_contact_id: null,
    ghl_last_synced_at: null,
    updated_at: "2026-09-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("system store — GHL persistence tier (W20–W22)", () => {
  // ── applyInbound — W20 update / W21 insert ──────────────────────────────

  test("applyInbound updates the matched row with the exact W20 payload, scoped by id + tenant", async () => {
    const mock = createMockSupabase([{ data: { id: "kon-1" } }]);
    const store = createSystemContactsStore(mock.client);

    const result = await store.applyInbound({
      tenantId: TENANT,
      existingContactId: "kon-1",
      update: W20_UPDATE,
      insert: W21_INSERT,
    });

    expect(result).toEqual({ contactId: "kon-1" });
    expect(mock.calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "update", args: [W20_UPDATE] },
      { op: "eq", args: ["id", "kon-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "select", args: ["id"] },
      { op: "single", args: [] },
    ]);
  });

  test("applyInbound inserts the exact W21 payload when no contact matched", async () => {
    const mock = createMockSupabase([{ data: { id: "kon-new" } }]);
    const store = createSystemContactsStore(mock.client);

    const result = await store.applyInbound({
      tenantId: TENANT,
      existingContactId: null,
      update: W20_UPDATE,
      insert: W21_INSERT,
    });

    expect(result).toEqual({ contactId: "kon-new" } );
    expect(mock.calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "insert", args: [W21_INSERT] },
      { op: "select", args: ["id"] },
      { op: "single", args: [] },
    ]);
  });

  test("applyInbound surfaces write errors from both branches", async () => {
    const updateMock = createMockSupabase([{ error: { message: "w20 write failed" } }]);
    const updateStore = createSystemContactsStore(updateMock.client);
    await expect(
      updateStore.applyInbound({
        tenantId: TENANT,
        existingContactId: "kon-1",
        update: W20_UPDATE,
        insert: W21_INSERT,
      }),
    ).rejects.toThrow("w20 write failed");

    const insertMock = createMockSupabase([{ error: { message: "w21 write failed" } }]);
    const insertStore = createSystemContactsStore(insertMock.client);
    await expect(
      insertStore.applyInbound({
        tenantId: TENANT,
        existingContactId: null,
        update: W20_UPDATE,
        insert: W21_INSERT,
      }),
    ).rejects.toThrow("w21 write failed");
  });

  // ── listOutbound — legacy bulk candidate listing ────────────────────────

  test("listOutbound pages all tenant contacts in created_at order (legacy listing shape)", async () => {
    const page = [outboundRow(), outboundRow({ id: "kon-out-2", created_at: "2026-08-02T00:00:00.000Z" })];
    const mock = createMockSupabase([{ data: page }]);
    const store = createSystemContactsStore(mock.client);

    const result = await store.listOutbound({ tenantId: TENANT, limit: 100, offset: 0 });

    expect(result).toEqual(page);
    expect(mock.calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["*"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "range", args: [0, 99] },
      { op: "order", args: ["created_at", { ascending: true }] },
    ]);

    // Second page advances the range window exactly like the legacy loop.
    const second = createMockSupabase([{ data: [] }]);
    const secondStore = createSystemContactsStore(second.client);
    await expect(secondStore.listOutbound({ tenantId: TENANT, limit: 100, offset: 100 })).resolves.toEqual(
      [],
    );
    expect(second.calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["*"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "range", args: [100, 199] },
      { op: "order", args: ["created_at", { ascending: true }] },
    ]);
  });

  test("listOutbound returns [] for a null page and surfaces read errors", async () => {
    const empty = createMockSupabase([{}]); // data null → []
    const emptyStore = createSystemContactsStore(empty.client);
    await expect(emptyStore.listOutbound({ tenantId: TENANT, limit: 50, offset: 0 })).resolves.toEqual([]);

    const failing = createMockSupabase([{ error: { message: "list failed" } }]);
    const failingStore = createSystemContactsStore(failing.client);
    await expect(failingStore.listOutbound({ tenantId: TENANT, limit: 50, offset: 0 })).rejects.toThrow(
      "list failed",
    );
  });

  // ── markOutboundSynced — W22 write-back ─────────────────────────────────

  test("markOutboundSynced writes the W22 write-back payload scoped by id + tenant", async () => {
    const mock = createMockSupabase([{}]);
    const store = createSystemContactsStore(mock.client);

    await store.markOutboundSynced({
      tenantId: TENANT,
      contactId: "kon-out-1",
      ghlContactId: "ghl-created-1",
      customFields: { existing_key: "keep", ghl_contact_id: "ghl-created-1" },
      syncedAt: "2026-09-13T11:00:00.000Z",
    });

    expect(mock.calls).toEqual([
      { op: "from", args: ["contacts"] },
      {
        op: "update",
        args: [
          {
            ghl_contact_id: "ghl-created-1",
            ghl_last_synced_at: "2026-09-13T11:00:00.000Z",
            custom_fields: { existing_key: "keep", ghl_contact_id: "ghl-created-1" },
            updated_at: "2026-09-13T11:00:00.000Z",
          },
        ],
      },
      { op: "eq", args: ["id", "kon-out-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);
  });

  test("markOutboundSynced surfaces write errors", async () => {
    const mock = createMockSupabase([{ error: { message: "w22 write failed" } }]);
    const store = createSystemContactsStore(mock.client);
    await expect(
      store.markOutboundSynced({
        tenantId: TENANT,
        contactId: "kon-out-1",
        ghlContactId: "ghl-created-1",
        customFields: {},
        syncedAt: "2026-09-13T11:00:00.000Z",
      }),
    ).rejects.toThrow("w22 write failed");
  });

  // ── appendSyncLog — contact_sync_log (20260320100000) ───────────────────

  test("appendSyncLog inserts the contact_sync_log row for created and error outcomes", async () => {
    const created = createMockSupabase([{}]);
    const createdStore = createSystemContactsStore(created.client);

    await createdStore.appendSyncLog({
      tenantId: TENANT,
      direction: "inbound",
      konnectContactId: "kon-1",
      ghlContactId: "ghl-9",
      action: "updated",
    });

    expect(created.calls).toEqual([
      { op: "from", args: ["contact_sync_log"] },
      {
        op: "insert",
        args: [
          {
            tenant_id: TENANT,
            direction: "inbound",
            konnect_contact_id: "kon-1",
            ghl_contact_id: "ghl-9",
            action: "updated",
            error_message: null,
            synced_at: expect.any(String),
          },
        ],
      },
    ]);

    const errored = createMockSupabase([{}]);
    const erroredStore = createSystemContactsStore(errored.client);

    await erroredStore.appendSyncLog({
      tenantId: TENANT,
      direction: "outbound",
      konnectContactId: "kon-out-1",
      ghlContactId: null,
      action: "error",
      errorMessage: "GHL API error [POST /contacts/]: 500 boom",
    });

    expect(errored.calls).toEqual([
      { op: "from", args: ["contact_sync_log"] },
      {
        op: "insert",
        args: [
          {
            tenant_id: TENANT,
            direction: "outbound",
            konnect_contact_id: "kon-out-1",
            ghl_contact_id: null,
            action: "error",
            error_message: "GHL API error [POST /contacts/]: 500 boom",
            synced_at: expect.any(String),
          },
        ],
      },
    ]);
  });

  // ── store hardening ─────────────────────────────────────────────────────

  test("GHL-tier methods require a tenantId", async () => {
    const mock = createMockSupabase();
    const store = createSystemContactsStore(mock.client);

    await expect(
      store.applyInbound({ tenantId: "", existingContactId: null, update: W20_UPDATE, insert: W21_INSERT }),
    ).rejects.toBeInstanceOf(TenantIdRequiredError);
    await expect(store.listOutbound({ tenantId: "", limit: 100, offset: 0 })).rejects.toBeInstanceOf(
      TenantIdRequiredError,
    );
    await expect(
      store.markOutboundSynced({
        tenantId: "",
        contactId: "kon-out-1",
        ghlContactId: "ghl-1",
        customFields: {},
        syncedAt: "2026-09-13T11:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(TenantIdRequiredError);
    await expect(
      store.appendSyncLog({ tenantId: "", direction: "inbound", action: "created" }),
    ).rejects.toBeInstanceOf(TenantIdRequiredError);
  });

  test("the system store structurally satisfies adapter-kit's ContactSyncPersistence seam", async () => {
    const mock = createMockSupabase();
    // Compile-time parity: this assignment only typechecks when the four
    // GHL-tier methods match adapter-kit's port shapes exactly.
    const persistence: ContactSyncPersistence = createSystemContactsStore(mock.client);

    expect(persistence.applyInbound).toBeTypeOf("function");
    expect(persistence.listOutbound).toBeTypeOf("function");
    expect(persistence.markOutboundSynced).toBeTypeOf("function");
    expect(persistence.appendSyncLog).toBeTypeOf("function");
  });
});
