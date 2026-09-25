import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createDealStore } from "../deal-store";

const TENANT = "ten-1";

function dealRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "d-1",
    tenant_id: TENANT,
    contact_id: null,
    company_id: null,
    name: "Big Deal",
    stage_id: "stage-1",
    value: 1000,
    currency: "USD",
    probability: null,
    expected_close_date: null,
    actual_close_date: null,
    description: null,
    tags: null,
    custom_fields: null,
    created_by: null,
    assigned_to: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createDealStore", () => {
  it("list() joins contact/company/stage and scopes to the tenant", async () => {
    const { client, calls } = createMockSupabase({ data: [dealRow()] });
    const store = createDealStore(client, TENANT);

    await store.list();

    expect(calls.find((c) => c.op === "from")?.args).toEqual(["deals"]);
    const selectArg = calls.find((c) => c.op === "select")?.args[0] as string;
    expect(selectArg).toContain("contact:contacts(*)");
    expect(selectArg).toContain("company:companies(*)");
    expect(selectArg).toContain("stage:deal_stages(*)");
  });

  it("listByStage() groups deals by stage_id", async () => {
    const { client } = createMockSupabase({
      data: [dealRow({ id: "d-1", stage_id: "s-a" }), dealRow({ id: "d-2", stage_id: "s-a" }), dealRow({ id: "d-3", stage_id: "s-b" })],
    });
    const store = createDealStore(client, TENANT);

    const grouped = await store.listByStage();

    expect(grouped["s-a"]?.map((d) => d.id)).toEqual(["d-1", "d-2"]);
    expect(grouped["s-b"]?.map((d) => d.id)).toEqual(["d-3"]);
  });

  it("create() rejects a company_id that does not belong to the tenant", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createDealStore(client, TENANT);

    await expect(store.create({ name: "x", stage_id: "stage-1", company_id: "other-tenant-co", value: 0 })).rejects.toThrow(
      "Company not found",
    );
  });

  it("create() rejects a contact_id that does not belong to the tenant", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createDealStore(client, TENANT);

    await expect(store.create({ name: "x", stage_id: "stage-1", contact_id: "other-tenant-contact", value: 0 })).rejects.toThrow(
      "Contact not found",
    );
  });

  it("create() rejects a stage_id that does not belong to the tenant", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createDealStore(client, TENANT);

    await expect(store.create({ name: "x", stage_id: "other-tenant-stage", value: 0 })).rejects.toThrow("Deal stage not found");
  });

  it("create() verifies every reference before inserting, normalizes empty strings, and logs a created activity", async () => {
    const { client, calls } = createMockSupabase([
      { data: { id: "co-1" } }, // company check
      { data: { id: "c-1" } }, // contact check
      { data: { id: "stage-1" } }, // stage check
      { data: dealRow({ company_id: "co-1", contact_id: "c-1" }) }, // deal insert
      { data: { id: "a-1" } }, // activity insert
    ]);
    const store = createDealStore(client, TENANT);

    await store.create({
      name: "Big Deal",
      stage_id: "stage-1",
      company_id: "co-1",
      contact_id: "c-1",
      value: 1000,
      currency: "",
      description: "",
      created_by: "",
    });

    expect(calls.filter((c) => c.op === "from").map((c) => c.args[0])).toEqual([
      "companies",
      "contacts",
      "deal_stages",
      "deals",
      "activities",
    ]);
    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs.tenant_id).toBe(TENANT);
    expect(insertArgs.currency).toBeNull();
    expect(insertArgs.description).toBeNull();
    expect(insertArgs.created_by).toBeNull();
  });

  it("update() re-verifies a changed stage_id before writing", async () => {
    const { client, calls } = createMockSupabase([{ data: null }]);
    const store = createDealStore(client, TENANT);

    await expect(store.update("d-1", { stage_id: "other-tenant-stage" })).rejects.toThrow("Deal stage not found");
    expect(calls.find((c) => c.op === "from")?.args).toEqual(["deal_stages"]);
  });

  it("remove() fetches the name before deleting and logs a deleted activity", async () => {
    const { client, calls } = createMockSupabase([{ data: { name: "Big Deal" } }, { data: null }, { data: { id: "a-1" } }]);
    const store = createDealStore(client, TENANT);

    await store.remove("d-1");

    const activityInsert = calls.filter((c) => c.op === "insert")[0]?.args[0] as Record<string, unknown>;
    expect(activityInsert.type).toBe("deleted");
    expect(activityInsert.deal_id).toBe("d-1");
  });
});
