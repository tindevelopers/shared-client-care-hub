import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createCompanyStore } from "../company-store";

const TENANT = "ten-1";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "co-1",
    tenant_id: TENANT,
    name: "Acme",
    website: null,
    industry: null,
    size: null,
    annual_revenue: null,
    description: null,
    address: null,
    phone: null,
    email: null,
    logo_url: null,
    tags: null,
    custom_fields: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createCompanyStore", () => {
  it("list() scopes to the tenant, newest first", async () => {
    const { client, calls } = createMockSupabase({ data: [row()] });
    const store = createCompanyStore(client, TENANT);

    await store.list();

    expect(calls.find((c) => c.op === "from")?.args).toEqual(["companies"]);
    expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toContainEqual(["tenant_id", TENANT]);
    expect(calls.find((c) => c.op === "order")?.args).toEqual(["created_at", { ascending: false }]);
  });

  it("get() returns null when the row is missing or cross-tenant", async () => {
    const { client } = createMockSupabase({ data: null });
    const store = createCompanyStore(client, TENANT);
    await expect(store.get("missing")).resolves.toBeNull();
  });

  it("create() injects tenant_id, normalizes empty-string fields to null, and logs a created activity", async () => {
    const { client, calls } = createMockSupabase([
      { data: row({ name: "Acme" }) }, // companies insert
      { data: { id: "a-1" } }, // activities insert
    ]);
    const store = createCompanyStore(client, TENANT);

    await store.create({
      name: "Acme",
      website: "",
      industry: "",
      phone: "",
      email: "",
      logo_url: "",
      created_by: "",
      annual_revenue: 0,
    });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs.tenant_id).toBe(TENANT);
    expect(insertArgs.website).toBeNull();
    expect(insertArgs.industry).toBeNull();
    expect(insertArgs.phone).toBeNull();
    expect(insertArgs.email).toBeNull();
    expect(insertArgs.logo_url).toBeNull();
    expect(insertArgs.created_by).toBeNull();
    // 0 is a legitimate annual_revenue, not an "empty" value — must survive ?? null.
    expect(insertArgs.annual_revenue).toBe(0);

    expect(calls.filter((c) => c.op === "from").map((c) => c.args[0])).toEqual(["companies", "activities"]);
    const activityInsert = calls.filter((c) => c.op === "insert")[1]?.args[0] as Record<string, unknown>;
    expect(activityInsert.type).toBe("created");
    expect(activityInsert.company_id).toBe("co-1");
  });

  it("update() scopes to id + tenant and logs an updated activity with the changes", async () => {
    const { client, calls } = createMockSupabase([{ data: row({ name: "Acme Renamed" }) }, { data: { id: "a-1" } }]);
    const store = createCompanyStore(client, TENANT);

    await store.update("co-1", { name: "Acme Renamed" });

    const eqArgs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["id", "co-1"]);
    expect(eqArgs).toContainEqual(["tenant_id", TENANT]);
    const activityInsert = calls.filter((c) => c.op === "insert")[0]?.args[0] as Record<string, unknown>;
    expect(activityInsert.type).toBe("updated");
    expect((activityInsert.metadata as { changes: unknown }).changes).toEqual({ name: "Acme Renamed" });
  });

  it("remove() fetches the name before deleting and logs a deleted activity", async () => {
    const { client, calls } = createMockSupabase([
      { data: { name: "Acme" } }, // select name
      { data: null }, // delete
      { data: { id: "a-1" } }, // activities insert
    ]);
    const store = createCompanyStore(client, TENANT);

    await store.remove("co-1");

    expect(calls.some((c) => c.op === "delete")).toBe(true);
    const activityInsert = calls.filter((c) => c.op === "insert")[0]?.args[0] as Record<string, unknown>;
    expect(activityInsert.type).toBe("deleted");
    expect(activityInsert.description).toContain("Acme");
  });

  it("remove() skips activity logging when the company was not found in the tenant", async () => {
    const { client, calls } = createMockSupabase([{ data: null }, { data: null }]);
    const store = createCompanyStore(client, TENANT);

    await store.remove("missing");

    expect(calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });

  it("bulkRemove() returns the exact deleted count, scoped to the tenant", async () => {
    const { client, calls } = createMockSupabase({ data: [{ id: "co-1" }, { id: "co-2" }] });
    const store = createCompanyStore(client, TENANT);

    await expect(store.bulkRemove(["co-1", "co-2", "other-tenant-id"])).resolves.toEqual({ deleted: 2 });
    expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toContainEqual(["tenant_id", TENANT]);
  });
});
