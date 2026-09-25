import { describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createActivityStore } from "../activity-store";

const TENANT = "ten-1";

describe("createActivityStore", () => {
  it("list() applies whichever filters are provided, scoped to the tenant", async () => {
    const { client, calls } = createMockSupabase({ data: [] });
    const store = createActivityStore(client, TENANT);

    await store.list({ task_id: "t-1" });

    const eqArgs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["tenant_id", TENANT]);
    expect(eqArgs).toContainEqual(["task_id", "t-1"]);
  });

  it("create() injects tenant_id and normalizes optional references/metadata", async () => {
    const { client, calls } = createMockSupabase({ data: { id: "a-1" } });
    const store = createActivityStore(client, TENANT);

    await store.create({ type: "created", description: "x", contact_id: "", company_id: "" });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs.tenant_id).toBe(TENANT);
    expect(insertArgs.contact_id).toBeNull();
    expect(insertArgs.company_id).toBeNull();
    expect(insertArgs.metadata).toEqual({});
  });

  it("logEntityCreated() writes a 'created' activity against the right FK column per entity type", async () => {
    const { client, calls } = createMockSupabase({ data: { id: "a-1" } });
    const store = createActivityStore(client, TENANT);

    await store.logEntityCreated("deal", "d-1", "Big Deal");

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs.type).toBe("created");
    expect(insertArgs.deal_id).toBe("d-1");
    expect(insertArgs.description).toBe('Deal "Big Deal" was created');
  });

  it("logEntityUpdated() records the changes under metadata.changes", async () => {
    const { client, calls } = createMockSupabase({ data: { id: "a-1" } });
    const store = createActivityStore(client, TENANT);

    await store.logEntityUpdated("company", "co-1", "Acme", { name: "Acme Renamed" });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs.type).toBe("updated");
    expect(insertArgs.metadata).toEqual({ changes: { name: "Acme Renamed" } });
  });

  it("logNoteAdded() sets note_id and the right parent FK", async () => {
    const { client, calls } = createMockSupabase({ data: { id: "a-1" } });
    const store = createActivityStore(client, TENANT);

    await store.logNoteAdded("n-1", "deal", "d-1");

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs.type).toBe("note_added");
    expect(insertArgs.note_id).toBe("n-1");
    expect(insertArgs.deal_id).toBe("d-1");
  });

  it("logging helpers swallow insert errors instead of throwing (activity logging must not break the caller's write)", async () => {
    const { client } = createMockSupabase({ error: { code: "500", message: "boom" } });
    const store = createActivityStore(client, TENANT);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(store.logEntityCreated("task", "t-1", "Follow up")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
