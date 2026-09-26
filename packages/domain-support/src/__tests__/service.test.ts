import { describe, expect, it, vi } from "vitest";
import { createSupportService, type SupportActor } from "../store";
import type { SupportNotification } from "../notifications";
import type { SupportOwner, SupportTicket } from "../types";
import {
  PARTNER,
  attachment,
  category,
  fakeGateway,
  fakeOwnerChain,
  fakeStore,
  group,
  link,
  thread,
  ticket,
} from "./fixtures";

function setup(options?: {
  send?: (input: SupportNotification) => Promise<void>;
  syncDeskBestEffort?: (t: SupportTicket) => Promise<void>;
  parent?: SupportOwner | null;
  actor?: SupportActor;
}) {
  const store = fakeStore();
  const escalations = fakeGateway();
  const ownerChain = fakeOwnerChain(
    options?.parent === undefined ? { scope: "partner", partnerId: "par-1" } : options.parent,
  );
  const sent: SupportNotification[] = [];
  const calls: string[] = [];
  const notifications = {
    send:
      options?.send ??
      (async (input: SupportNotification) => {
        sent.push(input);
      }),
  };
  const syncDeskBestEffort =
    options?.syncDeskBestEffort ??
    (async () => {
      calls.push("syncDeskBestEffort");
    });
  (store.saveTicket as ReturnType<typeof vi.fn>).mockImplementation(async (t: SupportTicket) => {
    calls.push("saveTicket");
    return t;
  });
  const service = createSupportService({
    actor: options?.actor ?? { id: "user-agent", isAgent: true },
    store,
    notifications,
    syncDeskBestEffort,
    ownerChain,
    escalations,
  });
  return { service, store, escalations, ownerChain, sent, calls };
}

const mockOf = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("createSupportService — store delegation", () => {
  it("lists tickets through the injected store only", async () => {
    const { service, store } = setup();
    const query = { status: "open" as const };
    await expect(service.listTickets(query)).resolves.toEqual([ticket()]);
    expect(store.listTickets).toHaveBeenCalledWith(query);
  });

  it("gets a ticket through the injected store only", async () => {
    const { service, store } = setup();
    await expect(service.getTicket("t-1")).resolves.toEqual(ticket());
    expect(store.getTicket).toHaveBeenCalledWith("t-1");
  });

  it("lists threads, attachments and categories through the injected store only", async () => {
    const { service, store } = setup();
    await expect(service.listThreads("t-1")).resolves.toEqual([thread()]);
    await expect(service.listAttachments("t-1")).resolves.toEqual([attachment]);
    await expect(service.listCategories()).resolves.toEqual([category]);
    expect(store.listThreads).toHaveBeenCalledWith("t-1");
    expect(store.listAttachments).toHaveBeenCalledWith("t-1");
    expect(store.listCategories).toHaveBeenCalledOnce();
  });

  it("saves and deletes categories through the injected store only", async () => {
    const { service, store } = setup();
    const input = { name: "Billing", description: null };
    await expect(service.saveCategory(input)).resolves.toEqual(category);
    await service.deleteCategory("c-1");
    expect(store.saveCategory).toHaveBeenCalledWith(input);
    expect(store.deleteCategory).toHaveBeenCalledWith("c-1");
  });

  it("lists and saves support groups through the injected store only", async () => {
    const { service, store } = setup();
    const input = { name: "Technical support", rank: 2 };
    await expect(service.listGroups()).resolves.toEqual([group]);
    await expect(service.saveGroup(input)).resolves.toEqual(group);
    expect(store.saveGroup).toHaveBeenCalledWith(input);
  });
});

describe("createSupportService — ticket creation", () => {
  it("writes the first-party ticket before any desk sync, recording the actor", async () => {
    const { service, calls, store } = setup();
    await service.createTicket(ticket({ assigned_to: "user-agent" }), "user-customer");
    expect(calls).toEqual(["saveTicket", "syncDeskBestEffort"]);
    expect(store.saveTicket).toHaveBeenCalledWith(expect.anything(), "user-customer");
  });

  it("notifies the customer and the assignee after creation", async () => {
    const { service, sent } = setup();
    const saved = await service.createTicket(ticket({ assigned_to: "user-agent" }), "user-customer");
    expect(saved.id).toBe("t-1");
    expect(sent.map((n) => [n.type, n.recipient])).toEqual([
      ["ticket_created", "customer"],
      ["ticket_created", "assignee"],
    ]);
    expect(sent[0].owner).toEqual({ scope: "tenant", tenantId: "ten-1" });
  });

  it("never breaks ticket creation when a notification or the desk sync fails", async () => {
    const { service, store } = setup({
      send: vi.fn().mockRejectedValue(new Error("smtp down")),
      syncDeskBestEffort: vi.fn().mockRejectedValue(new Error("desk down")),
    });
    const saved = await service.createTicket(ticket(), "user-customer");
    expect(saved.id).toBe("t-1");
    expect(store.saveTicket).toHaveBeenCalledOnce();
  });
});

describe("createSupportService — ticket updates", () => {
  it("merges the input onto the stored ticket and notifies changed fields", async () => {
    const { service, store, sent } = setup();
    const updated = await service.updateTicket("t-1", { status: "resolved", priority: "low" }, "user-agent");

    expect(store.saveTicket).toHaveBeenCalledWith(
      expect.objectContaining({ status: "resolved", priority: "low" }),
      "user-agent",
    );
    expect(updated?.status).toBe("resolved");
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("ticket_updated");
    expect(sent[0].recipient).toBe("customer");
  });

  it("moves a ticket to another support group (tier escalation)", async () => {
    const { service, store } = setup();
    await service.updateTicket("t-1", { group_id: "g-2", assigned_to: "user-programmer" }, "user-agent");
    expect(store.saveTicket).toHaveBeenCalledWith(
      expect.objectContaining({ group_id: "g-2", assigned_to: "user-programmer" }),
      "user-agent",
    );
  });

  it("rejects a status change the rules do not allow", async () => {
    const { service, store } = setup();
    mockOf(store.getTicket).mockResolvedValue(ticket({ status: "closed" }));
    await expect(service.updateTicket("t-1", { status: "open" }, "user-agent")).rejects.toThrow(
      'cannot move from "closed" to "open"',
    );
    expect(store.saveTicket).not.toHaveBeenCalled();
  });

  it("never sets waiting_on_upstream by hand", async () => {
    const { service } = setup();
    await expect(
      service.updateTicket("t-1", { status: "waiting_on_upstream" }, "user-agent"),
    ).rejects.toThrow();
  });

  it("refuses to resolve or close a ticket that escalations are waiting on", async () => {
    const { service, store } = setup();
    mockOf(store.listLinks).mockResolvedValue([link()]);
    await expect(service.updateTicket("t-1", { status: "resolved" }, "user-agent")).rejects.toThrow(
      "waiting on ticket TKT-1",
    );
    await expect(service.updateTicket("t-1", { status: "closed" }, "user-agent")).rejects.toThrow();
    expect(store.saveTicket).not.toHaveBeenCalled();
  });

  it("sends no notification when nothing changed", async () => {
    const { service, sent } = setup();
    await service.updateTicket("t-1", { status: "open" }, "user-agent");
    expect(sent).toEqual([]);
  });

  it("returns null when the ticket does not exist", async () => {
    const { service, store } = setup();
    mockOf(store.getTicket).mockResolvedValue(null);
    await expect(service.updateTicket("missing", { status: "closed" }, "user-agent")).resolves.toBeNull();
    expect(store.saveTicket).not.toHaveBeenCalled();
  });
});

describe("createSupportService — threads", () => {
  it("notifies the customer on an agent reply", async () => {
    const { service, store, sent } = setup();
    const created = await service.appendThread({ ticket_id: "t-1", user_id: "user-agent", message: "On it" });
    expect(store.appendThread).toHaveBeenCalledOnce();
    expect(created.id).toBe("th-1");
    expect(sent.map((n) => [n.type, n.recipient])).toEqual([["ticket_reply", "customer"]]);
  });

  it("notifies the assignee on a customer reply", async () => {
    const { service, store, sent } = setup();
    mockOf(store.getTicket).mockResolvedValue(ticket({ assigned_to: "user-agent" }));
    await service.appendThread({ ticket_id: "t-1", user_id: "user-customer", message: "Any update?" });
    expect(sent.map((n) => [n.type, n.recipient])).toEqual([["ticket_reply", "assignee"]]);
  });

  it("sends nothing for an unassigned customer reply or an internal note", async () => {
    const { service, sent } = setup();
    await service.appendThread({ ticket_id: "t-1", user_id: "user-customer", message: "Any update?" });
    await service.appendThread({ ticket_id: "t-1", user_id: "user-agent", message: "note", is_internal: true });
    expect(sent).toEqual([]);
  });
});

describe("createSupportService — clocks", () => {
  it("computes both clocks from the stored status history", async () => {
    const { service, store } = setup();
    mockOf(store.getTicket).mockResolvedValue(ticket({ created_at: "2026-01-05T09:00:00Z" }));
    mockOf(store.listStatusEvents).mockResolvedValue([
      { status: "waiting_on_upstream", at: "2026-01-05T10:00:00Z" },
      { status: "in_progress", at: "2026-01-05T12:00:00Z" },
    ]);
    const clocks = await service.getTicketClocks("t-1", "2026-01-05T13:00:00Z");
    expect(clocks).toEqual({ customerMs: 4 * 3_600_000, ownerMs: 2 * 3_600_000 });
  });

  it("returns null for a missing ticket", async () => {
    const { service, store } = setup();
    mockOf(store.getTicket).mockResolvedValue(null);
    await expect(service.getTicketClocks("missing")).resolves.toBeNull();
  });
});

describe("createSupportService — escalation", () => {
  const input = { actorId: "user-agent", fromOwnerLabel: "Acme Retail" };

  it("creates the upstream ticket in the parent owner's queue through the gateway", async () => {
    const { service, escalations, sent } = setup();
    const result = await service.escalateTicket("t-1", input);

    const call = mockOf(escalations.createUpstreamTicket).mock.calls[0][0];
    expect(call.downstreamTicketId).toBe("t-1");
    expect(call.actorId).toBe("user-agent");
    expect(call.draft.ticket).toMatchObject({ ...PARTNER, status: "open", created_by: "user-agent" });
    expect(result.upstreamTicket.id).toBe("t-up");
    expect(sent.map((n) => [n.type, n.recipient, n.ticketId])).toEqual([
      ["ticket_escalated", "owner_queue", "t-up"],
    ]);
  });

  it("shares nothing identifying the requester by default", async () => {
    const { service, store, escalations } = setup();
    mockOf(store.getTicket).mockResolvedValue(
      ticket({ created_by_user: { id: "user-customer", full_name: "Ann Lee", email: "ann@example.com" } }),
    );
    await service.escalateTicket("t-1", input);
    const { draft, shared } = mockOf(escalations.createUpstreamTicket).mock.calls[0][0];
    expect(JSON.stringify(draft)).not.toContain("ann@example.com");
    expect(JSON.stringify(draft)).not.toContain("Ann Lee");
    expect(draft.threads).toEqual([]);
    expect(draft.attachment_ids).toEqual([]);
    expect(shared.requester_contact).toBe(false);
  });

  it("refuses to escalate from the top of the chain", async () => {
    const { service, escalations } = setup({ parent: null });
    await expect(service.escalateTicket("t-1", input)).rejects.toThrow("top of the support chain");
    expect(escalations.createUpstreamTicket).not.toHaveBeenCalled();
  });

  it("refuses to escalate a ticket that is already waiting or finished", async () => {
    const { service, store } = setup();
    for (const status of ["waiting_on_upstream", "resolved", "closed"] as const) {
      mockOf(store.getTicket).mockResolvedValue(ticket({ status }));
      await expect(service.escalateTicket("t-1", input)).rejects.toThrow("cannot be escalated");
    }
  });

  it("leaves the downstream ticket untouched and notifies nobody when the gateway fails", async () => {
    const { service, store, escalations, sent } = setup();
    mockOf(escalations.createUpstreamTicket).mockRejectedValue(new Error("write failed"));
    await expect(service.escalateTicket("t-1", input)).rejects.toThrow("write failed");
    expect(store.saveTicket).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});

describe("createSupportService — resolution, send-back, withdrawal and merge", () => {
  it("resolves, then hands the resolution to every waiting ticket's agents", async () => {
    const { service, store, escalations, sent } = setup();
    mockOf(store.listLinks).mockResolvedValue([
      link({ id: "l-1", from_ticket_id: "t-a" }),
      link({ id: "l-2", from_ticket_id: "t-b" }),
    ]);

    const saved = await service.resolveTicket("t-1", { actorId: "user-partner", resolution: "Carrier fixed the route" });

    expect(saved.status).toBe("resolved");
    const { updates, actorId } = mockOf(escalations.handBack).mock.calls[0][0];
    expect(actorId).toBe("user-partner");
    expect(updates.map((u: { downstreamTicketId: string }) => u.downstreamTicketId)).toEqual(["t-a", "t-b"]);
    const upstreamResolved = sent.filter((n) => n.type === "upstream_resolved");
    expect(upstreamResolved.map((n) => [n.ticketId, n.recipient])).toEqual([
      ["t-a", "owner_queue"],
      ["t-b", "owner_queue"],
    ]);
    expect(sent.filter((n) => n.recipient === "customer").map((n) => n.ticketId)).toEqual(["t-1"]);
  });

  it("requires a resolution text", async () => {
    const { service, store } = setup();
    await expect(service.resolveTicket("t-1", { actorId: "u", resolution: "  " })).rejects.toThrow(
      "resolution is required",
    );
    expect(store.saveTicket).not.toHaveBeenCalled();
  });

  it("retries safely: an already-resolved ticket is not saved again but still hands back", async () => {
    const { service, store, escalations } = setup();
    mockOf(store.getTicket).mockResolvedValue(ticket({ status: "resolved" }));
    mockOf(store.listLinks).mockResolvedValue([link()]);
    await service.resolveTicket("t-1", { actorId: "u", resolution: "Fixed" });
    expect(store.saveTicket).not.toHaveBeenCalled();
    expect(escalations.handBack).toHaveBeenCalledOnce();
  });

  it("sends an escalation back: closes this ticket and tells the waiting agents why", async () => {
    const { service, store, escalations, sent } = setup();
    mockOf(store.listLinks).mockResolvedValue([link({ from_ticket_id: "t-a" })]);
    const saved = await service.returnEscalation("t-1", { actorId: "user-partner", reason: "Need the account number" });
    expect(saved.status).toBe("closed");
    const { updates } = mockOf(escalations.handBack).mock.calls[0][0];
    expect(updates[0]).toMatchObject({ linkState: "returned", downstreamStatus: "in_progress" });
    expect(sent.map((n) => [n.type, n.ticketId])).toEqual([["ticket_returned", "t-a"]]);
  });

  it("will not send back a ticket that is itself escalated", async () => {
    const { service, store } = setup();
    mockOf(store.getTicket).mockResolvedValue(ticket({ status: "waiting_on_upstream" }));
    mockOf(store.listLinks).mockResolvedValue([link()]);
    await expect(service.returnEscalation("t-1", { actorId: "u", reason: "no" })).rejects.toThrow(
      "withdraw that escalation",
    );
  });

  it("withdraws an escalation and resumes the ticket", async () => {
    const { service, store, escalations } = setup();
    mockOf(store.getTicket).mockResolvedValue(ticket({ status: "waiting_on_upstream" }));
    mockOf(store.listLinks).mockResolvedValue([link({ from_ticket_id: "t-1", to_ticket_id: "t-up" })]);
    const saved = await service.withdrawEscalation("t-1", { actorId: "user-agent", reason: "Solved it ourselves" });
    expect(mockOf(escalations.withdraw).mock.calls[0][0].plan).toMatchObject({
      upstreamTicketId: "t-up",
      note: "Escalation from ticket TKT-1 was withdrawn: Solved it ourselves",
    });
    expect(saved.status).toBe("in_progress");
  });

  it("merges a duplicate into a master through the gateway", async () => {
    const { service, store, escalations } = setup();
    mockOf(store.getTicket).mockImplementation(async (id: string) =>
      ticket({ id, ticket_number: `TKT-${id}` }),
    );
    mockOf(store.listLinks).mockResolvedValue([link({ id: "l-9", to_ticket_id: "t-dup" })]);
    await service.mergeTickets("t-dup", "t-master", { actorId: "user-partner" });
    expect(mockOf(escalations.merge).mock.calls[0][0].plan).toEqual({
      duplicateTicketId: "t-dup",
      masterTicketId: "t-master",
      repointLinkIds: ["l-9"],
      note: "Merged into ticket TKT-t-master.",
    });
  });
});
