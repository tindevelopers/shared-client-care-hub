import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createCounterpartyTicketStore } from "../counterparty-ticket-store";

const PARTNER_A = "partner-a";
const PARTNER_B = "partner-b";

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pt-1",
    partner_id: PARTNER_A,
    tenant_id: null,
    subject: "Client billing dispute",
    details: "",
    priority: "medium",
    status: "open",
    created_by: "user-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function replyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ptr-1",
    ticket_id: "pt-1",
    author_user_id: "user-1",
    body: "We're on it",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createCounterpartyTicketStore", () => {
  it("scopes list() to partner_id and applies every filter", async () => {
    const { client, calls } = createMockSupabase({ data: [ticketRow()] });
    const store = createCounterpartyTicketStore(client, PARTNER_A);

    await store.list({ status: "open", priority: "high", tenant_id: "ten-1" });

    expect(calls.find((c) => c.op === "from")?.args).toEqual(["partner_support_tickets"]);
    const eqCalls = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqCalls).toContainEqual(["partner_id", PARTNER_A]);
    expect(eqCalls).toContainEqual(["status", "open"]);
    expect(eqCalls).toContainEqual(["priority", "high"]);
    expect(eqCalls).toContainEqual(["tenant_id", "ten-1"]);
    // Never filters by tenant_id as the actor scope — partner_id is the only
    // ownership predicate always applied.
    expect(calls.filter((c) => c.op === "eq" && c.args[0] === "partner_id")).toHaveLength(1);
  });

  it("get() returns null on PGRST116 (not found / cross-partner)", async () => {
    const { client } = createMockSupabase({ error: { code: "PGRST116" } });
    const store = createCounterpartyTicketStore(client, PARTNER_A);
    await expect(store.get("missing")).resolves.toBeNull();
  });

  it("get() rethrows any other error", async () => {
    const { client } = createMockSupabase({ error: { code: "500", message: "boom" } });
    const store = createCounterpartyTicketStore(client, PARTNER_A);
    await expect(store.get("pt-1")).rejects.toEqual({ code: "500", message: "boom" });
  });

  it("a query for partner A never returns partner B's rows (get scoped by partner_id)", async () => {
    // Simulates RLS/ownership: partner B's ticket id, queried under partner A,
    // resolves to no row (the mock stands in for the eq("partner_id", ...)
    // filter actually excluding it at the DB).
    const { client } = createMockSupabase({ data: null, error: { code: "PGRST116" } });
    const store = createCounterpartyTicketStore(client, PARTNER_A);
    await expect(store.get("belongs-to-" + PARTNER_B)).resolves.toBeNull();
  });

  it("create() injects partner_id, defaults priority to medium and details to '', without synthesizing id/timestamps", async () => {
    const { client, calls } = createMockSupabase({ data: ticketRow() });
    const store = createCounterpartyTicketStore(client, PARTNER_A);

    await store.create({ subject: "Client billing dispute", created_by: "user-1" });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs).toEqual({
      partner_id: PARTNER_A,
      tenant_id: null,
      subject: "Client billing dispute",
      details: "",
      priority: "medium",
      created_by: "user-1",
    });
    expect(insertArgs).not.toHaveProperty("id");
    expect(insertArgs).not.toHaveProperty("created_at");
    expect(insertArgs).not.toHaveProperty("updated_at");
  });

  it("create() normalizes an empty-string tenant_id to null (uuid column rejects '')", async () => {
    const { client, calls } = createMockSupabase({ data: ticketRow() });
    const store = createCounterpartyTicketStore(client, PARTNER_A);

    await store.create({ subject: "x", created_by: "user-1", tenant_id: "" });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs.tenant_id).toBeNull();
  });

  it("update() sends only the defined fields, scopes to id + partner_id, and normalizes empty-string tenant_id to null", async () => {
    const { client, calls } = createMockSupabase({ data: ticketRow({ status: "resolved" }) });
    const store = createCounterpartyTicketStore(client, PARTNER_A);

    await store.update("pt-1", { status: "resolved", tenant_id: "" });

    expect(calls.find((c) => c.op === "update")?.args[0]).toEqual({
      status: "resolved",
      tenant_id: null,
    });
    const eqArgs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["id", "pt-1"]);
    expect(eqArgs).toContainEqual(["partner_id", PARTNER_A]);
  });

  it("remove() scopes the delete to id + partner_id", async () => {
    const { client, calls } = createMockSupabase({ data: null });
    const store = createCounterpartyTicketStore(client, PARTNER_A);

    await store.remove("pt-1");

    expect(calls.find((c) => c.op === "delete")).toBeTruthy();
    const eqArgs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["id", "pt-1"]);
    expect(eqArgs).toContainEqual(["partner_id", PARTNER_A]);
  });

  describe("replies", () => {
    it("list() verifies the ticket belongs to the partner before returning replies", async () => {
      const { client, calls } = createMockSupabase([
        { data: { id: "pt-1" } },
        { data: [replyRow()] },
      ]);
      const store = createCounterpartyTicketStore(client, PARTNER_A);

      const result = await store.replies.list("pt-1");

      expect(result).toHaveLength(1);
      expect(calls.filter((c) => c.op === "from").map((c) => c.args[0])).toEqual([
        "partner_support_tickets",
        "partner_support_ticket_replies",
      ]);
    });

    it("list() rejects when the ticket does not belong to this partner", async () => {
      const { client } = createMockSupabase([{ data: null }]);
      const store = createCounterpartyTicketStore(client, PARTNER_A);

      await expect(store.replies.list("belongs-to-" + PARTNER_B)).rejects.toThrow(
        "Ticket not found",
      );
    });

    it("create() verifies ticket ownership, then inserts with the injected author_user_id", async () => {
      const { client, calls } = createMockSupabase([
        { data: { id: "pt-1" } },
        { data: replyRow() },
      ]);
      const store = createCounterpartyTicketStore(client, PARTNER_A);

      const created = await store.replies.create({
        ticket_id: "pt-1",
        author_user_id: "user-1",
        body: "We're on it",
      });

      expect(created.id).toBe("ptr-1");
      const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
      expect(insertArgs).toEqual({
        ticket_id: "pt-1",
        author_user_id: "user-1",
        body: "We're on it",
      });
    });

    it("create() rejects when the ticket does not belong to this partner", async () => {
      const { client } = createMockSupabase([{ data: null }]);
      const store = createCounterpartyTicketStore(client, PARTNER_A);

      await expect(
        store.replies.create({
          ticket_id: "belongs-to-" + PARTNER_B,
          author_user_id: "user-1",
          body: "hi",
        }),
      ).rejects.toThrow("Ticket not found");
    });
  });
});
