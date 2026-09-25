import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createNoteStore } from "../note-store";

const TENANT = "ten-1";

function noteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "n-1",
    tenant_id: TENANT,
    contact_id: null,
    company_id: "co-1",
    deal_id: null,
    title: null,
    content: "Called the client",
    type: null,
    metadata: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createNoteStore", () => {
  it("create() rejects a note with no parent reference, without touching the database", async () => {
    const { client, calls } = createMockSupabase({});
    const store = createNoteStore(client, TENANT);

    await expect(store.create({ content: "x" })).rejects.toThrow(
      "Note must reference at least one of contact_id, company_id, or deal_id",
    );
    expect(calls).toHaveLength(0);
  });

  it("create() accepts more than one parent reference (at-least-one, not exactly-one)", async () => {
    const { client, calls } = createMockSupabase([
      { data: { id: "co-1" } }, // company check
      { data: { id: "d-1" } }, // deal check
      { data: noteRow({ company_id: "co-1", deal_id: "d-1" }) }, // note insert
      { data: { id: "a-1" } }, // activity insert
    ]);
    const store = createNoteStore(client, TENANT);

    await expect(store.create({ content: "x", company_id: "co-1", deal_id: "d-1" })).resolves.toBeTruthy();
    expect(calls.filter((c) => c.op === "from").map((c) => c.args[0])).toEqual(["companies", "deals", "notes", "activities"]);
  });

  it("create() rejects a contact_id that does not belong to the tenant", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createNoteStore(client, TENANT);

    await expect(store.create({ content: "x", contact_id: "other-tenant-contact" })).rejects.toThrow("Contact not found");
  });

  it("create() normalizes empty-string fields to null and logs note_added on the contact when contact_id is set", async () => {
    const { client, calls } = createMockSupabase([
      { data: { id: "c-1" } }, // contact check
      { data: noteRow({ contact_id: "c-1", company_id: null }) }, // note insert
      { data: { id: "a-1" } }, // activity insert
    ]);
    const store = createNoteStore(client, TENANT);

    await store.create({ content: "x", contact_id: "c-1", title: "", created_by: "" });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs.title).toBeNull();
    expect(insertArgs.created_by).toBeNull();

    const activityInsert = calls.filter((c) => c.op === "insert")[1]?.args[0] as Record<string, unknown>;
    expect(activityInsert.type).toBe("note_added");
    expect(activityInsert.contact_id).toBe("c-1");
  });

  it("list() applies whichever filters are provided, scoped to the tenant", async () => {
    const { client, calls } = createMockSupabase({ data: [noteRow()] });
    const store = createNoteStore(client, TENANT);

    await store.list({ company_id: "co-1" });

    const eqArgs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["tenant_id", TENANT]);
    expect(eqArgs).toContainEqual(["company_id", "co-1"]);
  });

  it("update() does not log an activity (DATA, not GLUE, per Konnect parity)", async () => {
    const { client, calls } = createMockSupabase({ data: noteRow({ content: "edited" }) });
    const store = createNoteStore(client, TENANT);

    await store.update("n-1", { content: "edited" });

    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });
});
