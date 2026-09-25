import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createCustomFieldStore } from "../custom-field-store";

const TENANT = "ten-1";

function fieldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cf-1",
    tenant_id: TENANT,
    entity: "contact",
    key: "shirt_size",
    label: "Shirt size",
    field_type: "select",
    options: ["S", "M", "L"],
    required: false,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createCustomFieldStore", () => {
  it("list() scopes to the tenant, ordered by position then key", async () => {
    const { client, calls } = createMockSupabase({ data: [fieldRow()] });
    const store = createCustomFieldStore(client, TENANT);

    await store.list();

    expect(calls.find((c) => c.op === "from")?.args).toEqual(["custom_field_definitions"]);
    expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toContainEqual(["tenant_id", TENANT]);
    expect(calls.filter((c) => c.op === "order").map((c) => c.args)).toEqual([
      ["position", { ascending: true }],
      ["key", { ascending: true }],
    ]);
  });

  it("list(entity) additionally filters by entity", async () => {
    const { client, calls } = createMockSupabase({ data: [fieldRow({ entity: "deal" })] });
    const store = createCustomFieldStore(client, TENANT);

    await store.list("deal");

    expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toContainEqual(["entity", "deal"]);
  });

  it("get() returns null when the row is missing or cross-tenant", async () => {
    const { client, calls } = createMockSupabase({ data: null });
    const store = createCustomFieldStore(client, TENANT);

    await expect(store.get("missing")).resolves.toBeNull();
    expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toContainEqual(["tenant_id", TENANT]);
  });

  it("create() injects tenant_id and defaults options/required/position", async () => {
    const { client, calls } = createMockSupabase({ data: fieldRow() });
    const store = createCustomFieldStore(client, TENANT);

    await store.create({ entity: "contact", key: "shirt_size", label: "Shirt size", field_type: "select" });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs).toMatchObject({
      tenant_id: TENANT,
      entity: "contact",
      key: "shirt_size",
      label: "Shirt size",
      field_type: "select",
      options: [],
      required: false,
      position: 0,
    });
  });

  it("create() preserves caller-supplied options/required/position", async () => {
    const { client, calls } = createMockSupabase({ data: fieldRow({ required: true, position: 3 }) });
    const store = createCustomFieldStore(client, TENANT);

    await store.create({
      entity: "company",
      key: "tier",
      label: "Tier",
      field_type: "select",
      options: ["Gold", "Silver"],
      required: true,
      position: 3,
    });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs).toMatchObject({ options: ["Gold", "Silver"], required: true, position: 3 });
  });

  it("update() scopes to id + tenant", async () => {
    const { client, calls } = createMockSupabase({ data: fieldRow({ label: "Renamed" }) });
    const store = createCustomFieldStore(client, TENANT);

    await store.update("cf-1", { label: "Renamed" });

    const eqArgs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["id", "cf-1"]);
    expect(eqArgs).toContainEqual(["tenant_id", TENANT]);
    const updateArgs = calls.find((c) => c.op === "update")?.args[0] as Record<string, unknown>;
    expect(updateArgs).toEqual({ label: "Renamed" });
  });

  it("remove() scopes the delete to id + tenant", async () => {
    const { client, calls } = createMockSupabase({ data: null });
    const store = createCustomFieldStore(client, TENANT);

    await store.remove("cf-1");

    expect(calls.some((c) => c.op === "delete")).toBe(true);
    const eqArgs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["id", "cf-1"]);
    expect(eqArgs).toContainEqual(["tenant_id", TENANT]);
  });
});
