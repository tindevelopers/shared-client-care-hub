import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createTaskStore } from "../task-store";

const TENANT = "ten-1";

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    tenant_id: TENANT,
    contact_id: null,
    company_id: "co-1",
    deal_id: null,
    title: "Follow up",
    description: null,
    status: "todo",
    priority: null,
    due_date: null,
    reminder_date: null,
    completed_at: null,
    created_by: null,
    assigned_to: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createTaskStore", () => {
  it("create() rejects zero parent references without touching the database", async () => {
    const { client, calls } = createMockSupabase({});
    const store = createTaskStore(client, TENANT);

    await expect(store.create({ title: "x" })).rejects.toThrow(
      "Task must reference exactly one of contact_id, company_id, or deal_id",
    );
    expect(calls).toHaveLength(0);
  });

  it("create() rejects more than one parent reference", async () => {
    const { client, calls } = createMockSupabase({});
    const store = createTaskStore(client, TENANT);

    await expect(store.create({ title: "x", company_id: "co-1", deal_id: "d-1" })).rejects.toThrow(
      "Task must reference exactly one of contact_id, company_id, or deal_id",
    );
    expect(calls).toHaveLength(0);
  });

  it("create() rejects a company_id that does not belong to the tenant", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createTaskStore(client, TENANT);

    await expect(store.create({ title: "x", company_id: "other-tenant-co" })).rejects.toThrow("Company not found");
  });

  it("create() rejects a deal_id that does not belong to the tenant", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createTaskStore(client, TENANT);

    await expect(store.create({ title: "x", deal_id: "other-tenant-deal" })).rejects.toThrow("Deal not found");
  });

  it("create() verifies the single reference, normalizes empty strings, and logs a created activity", async () => {
    const { client, calls } = createMockSupabase([
      { data: { id: "co-1" } }, // company check
      { data: taskRow() }, // task insert
      { data: { id: "a-1" } }, // activity insert
    ]);
    const store = createTaskStore(client, TENANT);

    await store.create({ title: "Follow up", company_id: "co-1", description: "", due_date: "", created_by: "" });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs.tenant_id).toBe(TENANT);
    expect(insertArgs.description).toBeNull();
    expect(insertArgs.due_date).toBeNull();
    expect(insertArgs.created_by).toBeNull();

    const activityInsert = calls.filter((c) => c.op === "insert")[1]?.args[0] as Record<string, unknown>;
    expect(activityInsert.type).toBe("created");
    expect(activityInsert.task_id).toBe("t-1");
  });

  it("update() auto-sets completed_at when status moves to done without one", async () => {
    const { client, calls } = createMockSupabase({ data: taskRow({ status: "done" }) });
    const store = createTaskStore(client, TENANT);

    await store.update("t-1", { status: "done" });

    const updateArgs = calls.find((c) => c.op === "update")?.args[0] as Record<string, unknown>;
    expect(updateArgs.status).toBe("done");
    expect(typeof updateArgs.completed_at).toBe("string");
  });

  it("update() does not override an explicit completed_at", async () => {
    const { client, calls } = createMockSupabase({ data: taskRow({ status: "done" }) });
    const store = createTaskStore(client, TENANT);

    await store.update("t-1", { status: "done", completed_at: "2026-02-02T00:00:00Z" });

    const updateArgs = calls.find((c) => c.op === "update")?.args[0] as Record<string, unknown>;
    expect(updateArgs.completed_at).toBe("2026-02-02T00:00:00Z");
  });

  it("update() re-verifies a changed deal_id before writing", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createTaskStore(client, TENANT);

    await expect(store.update("t-1", { deal_id: "other-tenant-deal" })).rejects.toThrow("Deal not found");
  });

  it("bulkComplete() returns the exact updated count, scoped to the tenant", async () => {
    const { client, calls } = createMockSupabase({ data: [{ id: "t-1" }] });
    const store = createTaskStore(client, TENANT);

    await expect(store.bulkComplete(["t-1", "other-tenant-task"])).resolves.toEqual({ updated: 1 });
    expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toContainEqual(["tenant_id", TENANT]);
  });

  it("bulkRemove() returns the exact deleted count, scoped to the tenant", async () => {
    const { client } = createMockSupabase({ data: [{ id: "t-1" }] });
    const store = createTaskStore(client, TENANT);

    await expect(store.bulkRemove(["t-1", "other-tenant-task"])).resolves.toEqual({ deleted: 1 });
  });
});
