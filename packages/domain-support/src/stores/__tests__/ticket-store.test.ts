import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createSupportTicketStore } from "../ticket-store";

const TENANT = "ten-1";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    tenant_id: TENANT,
    ticket_number: "TKT-1",
    subject: "Login broken",
    description: null,
    status: "open",
    priority: "medium",
    category_id: null,
    created_by: "user-1",
    assigned_to: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    support_code: null,
    support_ref: null,
    escalated_to_platform_admin_at: null,
    external_refs: {},
    sync_state: {},
    ...overrides,
  };
}

describe("createSupportTicketStore", () => {
  it("scopes list() to the tenant and applies every filter", async () => {
    const { client, calls } = createMockSupabase({ data: [row()] });
    const store = createSupportTicketStore(client, TENANT);

    await store.list({ status: "open", priority: "high", assigned_to: "a", created_by: "b", category_id: "c" });

    expect(calls.find((c) => c.op === "from")?.args).toEqual(["support_tickets"]);
    const eqCalls = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqCalls).toContainEqual(["tenant_id", TENANT]);
    expect(eqCalls).toContainEqual(["status", "open"]);
    expect(eqCalls).toContainEqual(["priority", "high"]);
    expect(eqCalls).toContainEqual(["assigned_to", "a"]);
    expect(eqCalls).toContainEqual(["created_by", "b"]);
    expect(eqCalls).toContainEqual(["category_id", "c"]);
  });

  it("get() returns null on PGRST116 (not found / cross-tenant)", async () => {
    const { client } = createMockSupabase({ error: { code: "PGRST116" } });
    const store = createSupportTicketStore(client, TENANT);
    await expect(store.get("missing")).resolves.toBeNull();
  });

  it("get() rethrows any other error", async () => {
    const { client } = createMockSupabase({ error: { code: "500", message: "boom" } });
    const store = createSupportTicketStore(client, TENANT);
    await expect(store.get("t-1")).rejects.toEqual({ code: "500", message: "boom" });
  });

  it("create() injects tenant_id and defaults priority to medium, without synthesizing id/ticket_number", async () => {
    const { client, calls } = createMockSupabase({ data: row() });
    const store = createSupportTicketStore(client, TENANT);

    await store.create({ subject: "Login broken", created_by: "user-1" });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs).toEqual({
      tenant_id: TENANT,
      subject: "Login broken",
      description: null,
      priority: "medium",
      category_id: null,
      created_by: "user-1",
      assigned_to: null,
      support_code: null,
      support_ref: null,
    });
    expect(insertArgs).not.toHaveProperty("id");
    expect(insertArgs).not.toHaveProperty("ticket_number");
  });

  it("create() rejects a category_id that does not belong to the tenant", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createSupportTicketStore(client, TENANT);

    await expect(
      store.create({ subject: "x", created_by: "user-1", category_id: "cat-2" }),
    ).rejects.toThrow("Category not found");
  });

  it("create() verifies category_id belongs to the tenant before inserting", async () => {
    const { client, calls } = createMockSupabase([
      { data: { id: "cat-1" } },
      { data: row({ category_id: "cat-1" }) },
    ]);
    const store = createSupportTicketStore(client, TENANT);

    await store.create({ subject: "x", created_by: "user-1", category_id: "cat-1" });

    expect(calls.filter((c) => c.op === "from").map((c) => c.args[0])).toEqual([
      "support_categories",
      "support_tickets",
    ]);
  });

  it("update() rejects a category_id that does not belong to the tenant", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createSupportTicketStore(client, TENANT);

    await expect(store.update("t-1", { category_id: "cat-2" })).rejects.toThrow("Category not found");
  });

  it("update() sends only the defined fields and scopes to id + tenant", async () => {
    const { client, calls } = createMockSupabase({ data: row({ status: "resolved" }) });
    const store = createSupportTicketStore(client, TENANT);

    await store.update("t-1", { status: "resolved" });

    expect(calls.find((c) => c.op === "update")?.args[0]).toEqual({ status: "resolved" });
    const eqArgs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["id", "t-1"]);
    expect(eqArgs).toContainEqual(["tenant_id", TENANT]);
  });

  it("stats() tallies status counts including pending/solved rollups", async () => {
    const { client } = createMockSupabase({
      data: [{ status: "open" }, { status: "open" }, { status: "in_progress" }, { status: "resolved" }, { status: "closed" }],
    });
    const store = createSupportTicketStore(client, TENANT);

    await expect(store.stats()).resolves.toEqual({
      total: 5,
      open: 2,
      in_progress: 1,
      resolved: 1,
      closed: 1,
      pending: 3,
      solved: 2,
    });
  });
});
