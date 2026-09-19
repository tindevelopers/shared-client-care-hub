import { describe, expect, test } from "vitest";
import { createContactListsStore, UnsupportedSegmentFilterError } from "../index.js";
import { createMockSupabase } from "./helpers/mock-supabase.js";
import type { TenantContactUpdate } from "../types.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("contact lists store", () => {
  test("binds list and cross-tenant update queries to the tenant", async () => {
    const { client, calls } = createMockSupabase([{ data: [] }, { data: null }]);
    const store = createContactListsStore(client, TENANT);

    await expect(store.list()).resolves.toEqual([]);
    await expect(store.update("other-tenant-list", { name: "Nope" })).resolves.toBeNull();

    expect(calls.filter((call) => call.op === "eq" && call.args[0] === "tenant_id")).toEqual([
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);
  });

  test("binds get, create, remove, and member removal to the tenant", async () => {
    const { client, calls } = createMockSupabase([
      { data: null },
      { data: { id: "group-1" } },
      { data: [] },
      { data: [] },
    ]);
    const store = createContactListsStore(client, TENANT);

    await store.get("group-1");
    await store.create({ name: "Customers" });
    await store.remove("group-1");
    await store.removeMembers("group-1", ["contact-1"]);

    expect(calls.filter((call) => call.op === "eq" && call.args[0] === "tenant_id")).toHaveLength(4);
  });

  test("duplicate members count only rows inserted by ignore-duplicates upsert", async () => {
    const { client, calls } = createMockSupabase({ data: [{ id: "member-new" }] });
    const store = createContactListsStore(client, TENANT);

    await expect(store.addMembers("group-1", ["contact-existing", "contact-new"])).resolves.toEqual({
      inserted: 1,
    });
    expect(calls).toContainEqual({
      op: "upsert",
      args: [
        [
          { tenant_id: TENANT, group_id: "group-1", contact_id: "contact-existing" },
          { tenant_id: TENANT, group_id: "group-1", contact_id: "contact-new" },
        ],
        { onConflict: "group_id,contact_id", ignoreDuplicates: true },
      ],
    });
    expect(calls).toContainEqual({ op: "eq", args: ["tenant_id", TENANT] });
  });

  test("lists saved-group contacts with tenant binding on members and contacts", async () => {
    const { client, calls } = createMockSupabase([
      { data: [{ contact_id: "contact-1" }] },
      { data: [{ id: "contact-1" }] },
    ]);
    const store = createContactListsStore(client, TENANT);

    await expect(store.listContacts("group-1")).resolves.toEqual([{ id: "contact-1" }]);
    expect(calls.filter((call) => call.op === "eq" && call.args[0] === "tenant_id")).toHaveLength(2);
  });

  test("previews tags, lifecycle stage, saved group, and explicit custom fields", async () => {
    const { client, calls } = createMockSupabase([
      { data: [{ contact_id: "contact-1" }] },
      { data: [{ id: "contact-1" }] },
    ]);
    const store = createContactListsStore(client, TENANT);

    await store.previewSegment({
      tags: ["vip"],
      lifecycleStage: "lead",
      contactGroupId: "group-1",
      customFields: { region: "west" },
    });

    expect(calls).toContainEqual({ op: "contains", args: ["tags", ["vip"]] });
    expect(calls).toContainEqual({
      op: "contains",
      args: ["custom_fields", { region: "west", lifecycle_stage: "lead" }],
    });
    expect(calls).toContainEqual({ op: "in", args: ["id", ["contact-1"]] });
  });

  test("rejects unsupported filters with a typed error before querying", async () => {
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
