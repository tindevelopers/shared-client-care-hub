import { describe, expect, it, vi } from "vitest";
import { persistSupportHandoff, type ConversationSupportDeps } from "../conversation-support";

function depsWithLog(log: string[]): ConversationSupportDeps {
  return {
    persistConversation: vi.fn(async () => {
      log.push("persistConversation");
      return "conv-1";
    }),
    createTicket: vi.fn(async (input) => {
      log.push("createTicket");
      expect(input.conversationId).toBe("conv-1");
      return "ticket-1";
    }),
    syncDeskBestEffort: vi.fn(async (ticketId) => {
      log.push("syncDeskBestEffort");
      expect(ticketId).toBe("ticket-1");
    }),
  };
}

const ticketDraft = { subject: "Cannot place order", description: "Checkout failed" };

describe("persistSupportHandoff", () => {
  it("persists a resolved FAQ conversation without creating a ticket", async () => {
    const log: string[] = [];
    const deps = depsWithLog(log);

    const result = await persistSupportHandoff(deps, {
      conversation: { channel: "chat" },
      outcome: "resolved",
      ticket: ticketDraft,
    });

    expect(result).toEqual({ conversationId: "conv-1", ticketId: undefined });
    expect(log).toEqual(["persistConversation"]);
    expect(deps.createTicket).not.toHaveBeenCalled();
    expect(deps.syncDeskBestEffort).not.toHaveBeenCalled();
  });

  it("does not create a ticket while policy acceptance is required", async () => {
    const log: string[] = [];
    const result = await persistSupportHandoff(depsWithLog(log), {
      conversation: {},
      outcome: "policy_required",
      ticket: ticketDraft,
    });

    expect(result.ticketId).toBeUndefined();
    expect(log).toEqual(["persistConversation"]);
  });

  it("creates a ticket and syncs the desk for an explicit ticket request, in order", async () => {
    const log: string[] = [];
    const deps = depsWithLog(log);

    const result = await persistSupportHandoff(deps, {
      conversation: { channel: "chat" },
      outcome: "ticket_requested",
      ticket: ticketDraft,
    });

    expect(result).toEqual({ conversationId: "conv-1", ticketId: "ticket-1" });
    expect(log).toEqual(["persistConversation", "createTicket", "syncDeskBestEffort"]);
    expect(deps.createTicket).toHaveBeenCalledWith({ ...ticketDraft, conversationId: "conv-1" });
  });

  it("creates a ticket for a successful human handoff", async () => {
    const log: string[] = [];
    const result = await persistSupportHandoff(depsWithLog(log), {
      conversation: {},
      outcome: "human_handoff",
      ticket: ticketDraft,
    });

    expect(result.ticketId).toBe("ticket-1");
    expect(log).toEqual(["persistConversation", "createTicket", "syncDeskBestEffort"]);
  });

  it("creates a ticket for an Operations escalation", async () => {
    const log: string[] = [];
    const result = await persistSupportHandoff(depsWithLog(log), {
      conversation: {},
      outcome: "operations_escalation",
      ticket: ticketDraft,
    });

    expect(result.ticketId).toBe("ticket-1");
    expect(log).toEqual(["persistConversation", "createTicket", "syncDeskBestEffort"]);
  });
});
