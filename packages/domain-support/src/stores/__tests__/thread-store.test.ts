import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createSupportThreadStore } from "../thread-store";

const TENANT = "ten-1";

function threadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "th-1",
    ticket_id: "t-1",
    tenant_id: TENANT,
    user_id: "user-agent",
    message: "We are on it",
    is_internal: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createSupportThreadStore", () => {
  it("list() excludes internal threads unless includeInternal is set", async () => {
    const { client, calls } = createMockSupabase({ data: [threadRow()] });
    const store = createSupportThreadStore(client, TENANT);

    await store.list("t-1");
    expect(calls.filter((c) => c.op === "not").map((c) => c.args)).toContainEqual([
      "is_internal",
      "is",
      true,
    ]);
  });

  it("list() treats a NULL is_internal as not internal (nullable column)", async () => {
    const { client, calls } = createMockSupabase({ data: [threadRow({ is_internal: null })] });
    const store = createSupportThreadStore(client, TENANT);

    const result = await store.list("t-1");
    expect(result).toHaveLength(1);
    expect(calls.filter((c) => c.op === "not").map((c) => c.args)).toContainEqual([
      "is_internal",
      "is",
      true,
    ]);
  });

  it("list() includes internal threads when requested", async () => {
    const { client, calls } = createMockSupabase({ data: [threadRow({ is_internal: true })] });
    const store = createSupportThreadStore(client, TENANT);

    await store.list("t-1", { includeInternal: true });
    expect(calls.filter((c) => c.op === "not")).toHaveLength(0);
  });

  it("create() verifies the ticket exists in the tenant, then inserts with the injected user_id", async () => {
    const { client, calls } = createMockSupabase([
      { data: { id: "t-1" } },
      { data: threadRow() },
    ]);
    const store = createSupportThreadStore(client, TENANT);

    const created = await store.create({ ticket_id: "t-1", user_id: "user-agent", message: "We are on it" });

    expect(created.id).toBe("th-1");
    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs).toEqual({
      ticket_id: "t-1",
      tenant_id: TENANT,
      user_id: "user-agent",
      message: "We are on it",
      is_internal: false,
    });
  });

  it("create() rejects when the ticket does not exist in this tenant", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createSupportThreadStore(client, TENANT);

    await expect(
      store.create({ ticket_id: "missing", user_id: "user-agent", message: "hi" }),
    ).rejects.toThrow("Ticket not found");
  });
});
