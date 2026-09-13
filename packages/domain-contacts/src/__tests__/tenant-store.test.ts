import { describe, expect, test } from "vitest";
import { createContactsStore } from "../tenant-store.js";
import { createMockSupabase } from "./helpers/mock-supabase.js";
import type { TenantContactInsert, TenantContactUpdate } from "../types.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const JOIN_SELECT = "*, company:companies(*)";

describe("tenant store create", () => {
  test("W4/W9/W17 payload parity: insert with injected tenant_id, company:companies(*) join select, single", async () => {
    const { client, calls } = createMockSupabase({ data: { id: "c-1" } });
    const store = createContactsStore(client, TENANT);

    const row = await store.create({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      company_id: "22222222-2222-2222-2222-222222222222",
      created_by: "u-1",
    });

    expect(row).toEqual({ id: "c-1" });
    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      {
        op: "insert",
        args: [
          {
            first_name: "Ada",
            last_name: "Lovelace",
            email: "ada@example.com",
            company_id: "22222222-2222-2222-2222-222222222222",
            created_by: "u-1",
            tenant_id: TENANT,
          },
        ],
      },
      { op: "select", args: [JOIN_SELECT] },
      { op: "single", args: [] },
    ]);
  });

  test("duplicate email: 23505 maps to DuplicateEmailError with the existing W4 message", async () => {
    const { client } = createMockSupabase({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "contacts_tenant_email_unique"' },
    });
    const store = createContactsStore(client, TENANT);

    const error: Error & { name?: string } = await store
      .create({ first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" })
      .catch((e) => e);

    expect(error.name).toBe("DuplicateEmailError");
    expect(error.message).toBe('A contact with email "ada@example.com" already exists.');
  });

  test("rethrows non-23505 insert errors unchanged", async () => {
    const boom = { code: "42P01", message: "relation does not exist" };
    const { client } = createMockSupabase({ data: null, error: boom });
    const store = createContactsStore(client, TENANT);

    await expect(store.create({ first_name: "A", last_name: "B" })).rejects.toEqual(boom);
  });
});

describe("tenant store update tenant scoping", () => {
  test("W5/W10 payload parity: update patch scoped by id + tenant_id, join select, single", async () => {
    const { client, calls } = createMockSupabase({ data: { id: "c-1", job_title: "CTO" } });
    const store = createContactsStore(client, TENANT);

    const row = await store.update("c-1", { job_title: "CTO" });

    expect(row).toEqual({ id: "c-1", job_title: "CTO" });
    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "update", args: [{ job_title: "CTO" }] },
      { op: "eq", args: ["id", "c-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "select", args: [JOIN_SELECT] },
      { op: "single", args: [] },
    ]);
  });

  test("PGRST116 (cross-tenant or missing id, zero rows) maps to ContactNotFoundError", async () => {
    const { client } = createMockSupabase({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });
    const store = createContactsStore(client, TENANT);

    const error: Error & { name?: string } = await store
      .update("c-other-tenant", { notes: "nope" })
      .catch((e) => e);

    expect(error.name).toBe("ContactNotFoundError");
  });

  test("rethrows non-PGRST116 update errors unchanged", async () => {
    const boom = { code: "42501", message: "row-level security policy violation" };
    const { client } = createMockSupabase({ data: null, error: boom });
    const store = createContactsStore(client, TENANT);

    await expect(store.update("c-1", { notes: "x" })).rejects.toEqual(boom);
  });
});

describe("tenant store remove", () => {
  test("W6/W11 payload parity: delete scoped by id + tenant_id, no select", async () => {
    const { client, calls } = createMockSupabase();
    const store = createContactsStore(client, TENANT);

    await expect(store.remove("c-1")).resolves.toBeUndefined();

    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "delete", args: [] },
      { op: "eq", args: ["id", "c-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);
  });
});

describe("tenant store bulkRemove", () => {
  test("W7 payload parity: delete + in + tenant eq + select('id'); returns exact deleted count", async () => {
    const { client, calls } = createMockSupabase({ data: [{ id: "c-1" }, { id: "c-2" }], count: 2 });
    const store = createContactsStore(client, TENANT);

    const result = await store.bulkRemove(["c-1", "c-2", "c-missing"]);

    expect(result).toEqual({ deleted: 2 });
    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "delete", args: [] },
      { op: "in", args: ["id", ["c-1", "c-2", "c-missing"]] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "select", args: ["id"] },
    ]);
  });
});

describe("tenant store mergeTags", () => {
  test("W8 payload parity: read id+tags, then per-row update with union-dedupe; null tags treated as []", async () => {
    const { client, calls } = createMockSupabase([
      { data: [{ id: "c-1", tags: ["a", "b"] }, { id: "c-2", tags: null }] },
      { error: null },
      { error: null },
    ]);
    const store = createContactsStore(client, TENANT);

    const result = await store.mergeTags(["c-1", "c-2"], ["b", "c"]);

    expect(result).toEqual({ updated: 2 });
    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id, tags"] },
      { op: "in", args: ["id", ["c-1", "c-2"]] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "from", args: ["contacts"] },
      { op: "update", args: [{ tags: ["a", "b", "c"] }] },
      { op: "eq", args: ["id", "c-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "from", args: ["contacts"] },
      { op: "update", args: [{ tags: ["b", "c"] }] },
      { op: "eq", args: ["id", "c-2"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);
  });

  test("W8 counts only rows whose update succeeded (`if (!updateError) updated++`)", async () => {
    const { client } = createMockSupabase([
      { data: [{ id: "c-1", tags: ["a"] }, { id: "c-2", tags: ["x"] }] },
      { error: { message: "boom" } },
      { error: null },
    ]);
    const store = createContactsStore(client, TENANT);

    const result = await store.mergeTags(["c-1", "c-2"], ["b"]);

    expect(result).toEqual({ updated: 1 });
  });

  test("W8 read parity: fetch error surfaces instead of updating", async () => {
    const { client, calls } = createMockSupabase({ error: { message: "fetch failed" } });
    const store = createContactsStore(client, TENANT);

    await expect(store.mergeTags(["c-1"], ["b"])).rejects.toEqual({ message: "fetch failed" });
    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id, tags"] },
      { op: "in", args: ["id", ["c-1"]] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);
  });
});

describe("tenant store bulkCreate", () => {
  test("W18 payload parity: single array insert with tenant_id injected per row, no select", async () => {
    const { client, calls } = createMockSupabase();
    const store = createContactsStore(client, TENANT);

    await expect(
      store.bulkCreate([
        { first_name: "A", last_name: "B", email: "a@example.com" },
        { first_name: "C", last_name: "D", email: null },
      ]),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      {
        op: "insert",
        args: [
          [
            { first_name: "A", last_name: "B", email: "a@example.com", tenant_id: TENANT },
            { first_name: "C", last_name: "D", email: null, tenant_id: TENANT },
          ],
        ],
      },
    ]);
  });

  test("empty input performs no query", async () => {
    const { client, calls } = createMockSupabase();
    const store = createContactsStore(client, TENANT);

    await expect(store.bulkCreate([])).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});

describe("tenant store type constraints (compile-time)", () => {
  test("service-role-only and DB-owned columns are not writable through the tenant tier", () => {
    // Each object below must FAIL to type-check; `pnpm type-check` proves the
    // expect-error directives are live (an allowed key would make tsc fail
    // with "Unused '@ts-expect-error' directive").
    const patches: TenantContactUpdate[] = [
      // @ts-expect-error last_inbound_at is service-role-only (W1/W2/W3/W16)
      { last_inbound_at: "2026-01-01T00:00:00Z" },
      // @ts-expect-error last_contacted_at is service-role-only (W3/W16)
      { last_contacted_at: "2026-01-01T00:00:00Z" },
      // @ts-expect-error phone_e164 is service-role-only (W3)
      { phone_e164: "+15550000000" },
      // @ts-expect-error email_opt_out is service-role-only (W12/W13/W14)
      { email_opt_out: true },
      // @ts-expect-error email_valid is service-role-only (W14)
      { email_valid: false },
      // @ts-expect-error sms_opt_out is service-role-only (W15)
      { sms_opt_out: true },
      // @ts-expect-error ghl_contact_id is service-role-only (W20–W22)
      { ghl_contact_id: "ghl-1" },
      // @ts-expect-error ghl_last_synced_at is service-role-only (W20–W22)
      { ghl_last_synced_at: "2026-01-01T00:00:00Z" },
      // @ts-expect-error updated_at is owned by the DB trigger (never sent)
      { updated_at: "2026-01-01T00:00:00Z" },
      // @ts-expect-error id is never caller-supplied on update
      { id: "c-1" },
    ];
    expect(patches).toHaveLength(10);

    // @ts-expect-error tenant_id is injected by the store, never caller-supplied
    const badInsert: TenantContactInsert = { first_name: "A", last_name: "B", tenant_id: TENANT };
    // @ts-expect-error service-role columns are not insertable through the tenant tier
    const badInsert2: TenantContactInsert = { first_name: "A", last_name: "B", sms_opt_out: true };
    expect([badInsert, badInsert2]).toHaveLength(2);

    // Sanity: the writable surface is still there.
    const ok: TenantContactUpdate = { email: "ok@example.com", tags: ["t"] };
    expect(ok.email).toBe("ok@example.com");
  });
});
