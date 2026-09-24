import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createSupportStore } from "../support-store";

const TENANT = "ten-1";

describe("createSupportStore", () => {
  it("routes saveCategory to create when id is absent", async () => {
    const { client, calls } = createMockSupabase({
      data: { id: "c-1", tenant_id: TENANT, name: "Billing", description: null, is_active: true },
    });
    const store = createSupportStore(client, TENANT);

    await store.saveCategory({ name: "Billing" });
    expect(calls.some((c) => c.op === "insert")).toBe(true);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("routes saveCategory to update when id is present", async () => {
    const { client, calls } = createMockSupabase({
      data: { id: "c-1", tenant_id: TENANT, name: "Renamed", description: null, is_active: true },
    });
    const store = createSupportStore(client, TENANT);

    await store.saveCategory({ id: "c-1", name: "Renamed" });
    expect(calls.some((c) => c.op === "update")).toBe(true);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("satisfies the full SupportStore contract createSupportService depends on", () => {
    const { client } = createMockSupabase();
    const store = createSupportStore(client, TENANT);
    for (const method of [
      "listTickets",
      "getTicket",
      "createTicket",
      "updateTicket",
      "listThreads",
      "appendThread",
      "listAttachments",
      "listCategories",
      "saveCategory",
      "deleteCategory",
    ] as const) {
      expect(store[method]).toBeInstanceOf(Function);
    }
  });
});
