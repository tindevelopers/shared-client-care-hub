import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createSupportCategoryStore } from "../category-store";

const TENANT = "ten-1";

function categoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    tenant_id: TENANT,
    name: "Billing",
    description: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createSupportCategoryStore", () => {
  it("list() scopes to the tenant and only active categories, ordered by name", async () => {
    const { client, calls } = createMockSupabase({ data: [categoryRow()] });
    const store = createSupportCategoryStore(client, TENANT);

    await store.list();
    const eqArgs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["tenant_id", TENANT]);
    expect(eqArgs).toContainEqual(["is_active", true]);
    expect(calls.find((c) => c.op === "order")?.args).toEqual(["name", { ascending: true }]);
  });

  it("create() injects tenant_id and defaults is_active to true", async () => {
    const { client, calls } = createMockSupabase({ data: categoryRow() });
    const store = createSupportCategoryStore(client, TENANT);

    await store.create({ name: "Billing" });
    expect(calls.find((c) => c.op === "insert")?.args[0]).toEqual({
      tenant_id: TENANT,
      name: "Billing",
      description: null,
      is_active: true,
    });
  });

  it("create() normalizes an empty-string description to null", async () => {
    const { client, calls } = createMockSupabase({ data: categoryRow() });
    const store = createSupportCategoryStore(client, TENANT);

    await store.create({ name: "Billing", description: "" });
    expect((calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>).description).toBeNull();
  });

  it("remove() soft-deletes by setting is_active to false, never a hard delete", async () => {
    const { client, calls } = createMockSupabase({ data: null });
    const store = createSupportCategoryStore(client, TENANT);

    await store.remove("c-1");
    expect(calls.some((c) => c.op === "delete")).toBe(false);
    expect(calls.find((c) => c.op === "update")?.args[0]).toEqual({ is_active: false });
  });
});
