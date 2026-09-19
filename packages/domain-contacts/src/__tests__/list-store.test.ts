import { describe, expect, test } from "vitest";
import { createContactListsStore, UnsupportedSegmentFilterError } from "../index.js";
import { createMockSupabase } from "./helpers/mock-supabase.js";
import type { TenantContactUpdate } from "../types.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

/**
 * Call-sequence assertions: every tenant predicate is proven to belong to the
 * query it guards (each `eq tenant_id` immediately follows its own `from`),
 * not merely counted somewhere in the recorded calls.
 */
describe("contact lists store", () => {
  test("list binds the contact_groups query to the tenant", async () => {
    const { client, calls } = createMockSupabase({ data: [] });
    const store = createContactListsStore(client, TENANT);

    await expect(store.list()).resolves.toEqual([]);
    expect(calls).toEqual([
      { op: "from", args: ["contact_groups"] },
      { op: "select", args: ["*"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "order", args: ["created_at", { ascending: false }] },
    ]);
  });

  test("get binds id + tenant on one query; a cross-tenant id resolves null", async () => {
    const { client, calls } = createMockSupabase({ data: null });
    const store = createContactListsStore(client, TENANT);

    await expect(store.get("group-other-tenant")).resolves.toBeNull();
    expect(calls).toEqual([
      { op: "from", args: ["contact_groups"] },
      { op: "select", args: ["*"] },
      { op: "eq", args: ["id", "group-other-tenant"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "maybeSingle", args: [] },
    ]);
  });

  test("update of a cross-tenant id affects zero rows and resolves null", async () => {
    const { client, calls } = createMockSupabase({ data: null });
    const store = createContactListsStore(client, TENANT);

    await expect(store.update("group-other-tenant", { name: "Nope" })).resolves.toBeNull();
    expect(calls).toEqual([
      { op: "from", args: ["contact_groups"] },
      { op: "update", args: [{ name: "Nope" }] },
      { op: "eq", args: ["id", "group-other-tenant"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "select", args: ["*"] },
      { op: "maybeSingle", args: [] },
    ]);
  });

  test("create injects tenant_id into the inserted row", async () => {
    const { client, calls } = createMockSupabase({ data: { id: "group-1" } });
    const store = createContactListsStore(client, TENANT);

    await expect(store.create({ name: "Customers" })).resolves.toEqual({ id: "group-1" });
    expect(calls).toEqual([
      { op: "from", args: ["contact_groups"] },
      { op: "insert", args: [{ name: "Customers", tenant_id: TENANT }] },
      { op: "select", args: ["*"] },
      { op: "single", args: [] },
    ]);
  });

  test("remove of a cross-tenant id deletes zero rows", async () => {
    const { client, calls } = createMockSupabase({ data: [] });
    const store = createContactListsStore(client, TENANT);

    await expect(store.remove("group-other-tenant")).resolves.toEqual({ deleted: 0 });
    expect(calls).toEqual([
      { op: "from", args: ["contact_groups"] },
      { op: "delete", args: [] },
      { op: "eq", args: ["id", "group-other-tenant"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "select", args: ["id"] },
    ]);
  });

  test("addMembers on a cross-tenant group is a zero-effect no-op (no upsert issued)", async () => {
    const { client, calls } = createMockSupabase({ data: null });
    const store = createContactListsStore(client, TENANT);

    await expect(store.addMembers("group-other-tenant", ["contact-1"])).resolves.toEqual({
      inserted: 0,
    });
    expect(calls).toEqual([
      { op: "from", args: ["contact_groups"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["id", "group-other-tenant"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "maybeSingle", args: [] },
    ]);
  });

  test("addMembers upserts only tenant-owned contacts; duplicates count only inserted rows", async () => {
    const { client, calls } = createMockSupabase([
      { data: { id: "group-1" } }, // in-tenant group check
      { data: [{ id: "contact-new" }] }, // tenant narrowing: contact-other-tenant absent
      { data: [{ id: "member-new" }] }, // ignore-duplicates upsert returns only new rows
    ]);
    const store = createContactListsStore(client, TENANT);

    await expect(
      store.addMembers("group-1", ["contact-new", "contact-other-tenant"]),
    ).resolves.toEqual({ inserted: 1 });
    expect(calls).toEqual([
      { op: "from", args: ["contact_groups"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["id", "group-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "maybeSingle", args: [] },
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "in", args: ["id", ["contact-new", "contact-other-tenant"]] },
      { op: "from", args: ["contact_group_members"] },
      {
        op: "upsert",
        args: [
          [{ tenant_id: TENANT, group_id: "group-1", contact_id: "contact-new" }],
          { onConflict: "group_id,contact_id", ignoreDuplicates: true },
        ],
      },
      { op: "select", args: ["id"] },
    ]);
  });

  test("addMembers with only cross-tenant contacts issues no write", async () => {
    const { client, calls } = createMockSupabase([
      { data: { id: "group-1" } },
      { data: [] }, // no requested contact belongs to this tenant
    ]);
    const store = createContactListsStore(client, TENANT);

    await expect(store.addMembers("group-1", ["contact-other-tenant"])).resolves.toEqual({
      inserted: 0,
    });
    expect(calls.some((call) => call.op === "upsert")).toBe(false);
  });

  test("addMembers with an empty contact list performs no query", async () => {
    const { client, calls } = createMockSupabase();
    const store = createContactListsStore(client, TENANT);

    await expect(store.addMembers("group-1", [])).resolves.toEqual({ inserted: 0 });
    expect(calls).toEqual([]);
  });

  test("removeMembers binds tenant + group + contacts on one delete; cross-tenant ids delete zero", async () => {
    const { client, calls } = createMockSupabase({ data: [] });
    const store = createContactListsStore(client, TENANT);

    await expect(
      store.removeMembers("group-1", ["contact-1", "contact-other-tenant"]),
    ).resolves.toEqual({ deleted: 0 });
    expect(calls).toEqual([
      { op: "from", args: ["contact_group_members"] },
      { op: "delete", args: [] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["group_id", "group-1"] },
      { op: "in", args: ["contact_id", ["contact-1", "contact-other-tenant"]] },
      { op: "select", args: ["id"] },
    ]);
  });

  test("listContacts resolves members then contacts, both tenant-bound", async () => {
    const { client, calls } = createMockSupabase([
      { data: [{ contact_id: "contact-1" }] },
      { data: [{ id: "contact-1" }] },
    ]);
    const store = createContactListsStore(client, TENANT);

    await expect(store.listContacts("group-1")).resolves.toEqual([{ id: "contact-1" }]);
    expect(calls).toEqual([
      { op: "from", args: ["contact_group_members"] },
      { op: "select", args: ["contact_id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["group_id", "group-1"] },
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["*"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "in", args: ["id", ["contact-1"]] },
      { op: "order", args: ["created_at", { ascending: false }] },
    ]);
  });

  test("previewSegment supports tags, lifecycle stage, saved group, and explicit custom fields", async () => {
    const { client, calls } = createMockSupabase([
      { data: [{ contact_id: "contact-1" }] },
      { data: [{ id: "contact-1" }] },
    ]);
    const store = createContactListsStore(client, TENANT);

    await expect(
      store.previewSegment({
        tags: ["vip"],
        lifecycleStage: "lead",
        contactGroupId: "group-1",
        customFields: { region: "west" },
      }),
    ).resolves.toEqual([{ id: "contact-1" }]);
    expect(calls).toEqual([
      { op: "from", args: ["contact_group_members"] },
      { op: "select", args: ["contact_id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["group_id", "group-1"] },
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["*"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "contains", args: ["tags", ["vip"]] },
      {
        op: "contains",
        args: ["custom_fields", { region: "west", lifecycle_stage: "lead" }],
      },
      { op: "in", args: ["id", ["contact-1"]] },
      { op: "order", args: ["created_at", { ascending: false }] },
    ]);
  });

  test("previewSegment on a cross-tenant group returns empty before querying contacts", async () => {
    const { client, calls } = createMockSupabase({ data: [] });
    const store = createContactListsStore(client, TENANT);

    await expect(store.previewSegment({ contactGroupId: "group-other-tenant" })).resolves.toEqual(
      [],
    );
    expect(calls).toEqual([
      { op: "from", args: ["contact_group_members"] },
      { op: "select", args: ["contact_id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["group_id", "group-other-tenant"] },
    ]);
  });

  test("previewSegment rejects unsupported filters with a typed error before querying", async () => {
    const { client, calls } = createMockSupabase();
    const store = createContactListsStore(client, TENANT);

    await expect(store.previewSegment({ score: 10 })).rejects.toBeInstanceOf(
      UnsupportedSegmentFilterError,
    );
    expect(calls).toEqual([]);
  });

  test("legacy suppression flags are protected from tenant contact patches", () => {
    // @ts-expect-error whatsapp_opt_out is owned by the canonical suppression store
    const whatsappPatch: TenantContactUpdate = { whatsapp_opt_out: true };
    // @ts-expect-error dnc is service-role-only
    const dncPatch: TenantContactUpdate = { dnc: true };
    expect([whatsappPatch, dncPatch]).toHaveLength(2);
  });
});
