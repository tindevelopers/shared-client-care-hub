import { describe, expect, it, vi } from "vitest";
import { SupportForbiddenError, createSupportService, requireAgent, type SupportActor } from "../store";
import { attachment, fakeGateway, fakeOwnerChain, fakeStore, thread } from "./fixtures";

const AGENT: SupportActor = { id: "user-agent", isAgent: true };
const MEMBER: SupportActor = { id: "user-customer", isAgent: false };

function setup(actor: SupportActor) {
  const store = fakeStore();
  const escalations = fakeGateway();
  const service = createSupportService({
    actor,
    store,
    notifications: { send: vi.fn().mockResolvedValue(undefined) },
    syncDeskBestEffort: vi.fn().mockResolvedValue(undefined),
    ownerChain: fakeOwnerChain({ scope: "partner", partnerId: "par-1" }),
    escalations,
  });
  return { service, store, escalations };
}

type Setup = ReturnType<typeof setup>;

/** Every agent-only operation, with the store/gateway call it must never reach for a non-agent. */
const GATED: Array<[string, (s: Setup) => Promise<unknown>, (s: Setup) => unknown]> = [
  ["updateTicket", (s) => s.service.updateTicket("t-1", { status: "in_progress" }, "u"), (s) => s.store.saveTicket],
  ["escalateTicket", (s) => s.service.escalateTicket("t-1", { actorId: "u", fromOwnerLabel: "Acme" }), (s) => s.escalations.createUpstreamTicket],
  ["resolveTicket", (s) => s.service.resolveTicket("t-1", { actorId: "u", resolution: "Fixed" }), (s) => s.store.saveTicket],
  ["returnEscalation", (s) => s.service.returnEscalation("t-1", { actorId: "u", reason: "No" }), (s) => s.store.saveTicket],
  ["withdrawEscalation", (s) => s.service.withdrawEscalation("t-1", { actorId: "u" }), (s) => s.escalations.withdraw],
  ["mergeTickets", (s) => s.service.mergeTickets("t-dup", "t-master", { actorId: "u" }), (s) => s.escalations.merge],
  ["saveCategory", (s) => s.service.saveCategory({ name: "Billing" }), (s) => s.store.saveCategory],
  ["deleteCategory", (s) => s.service.deleteCategory("c-1"), (s) => s.store.deleteCategory],
  ["saveGroup", (s) => s.service.saveGroup({ name: "Tier 2", rank: 2 }), (s) => s.store.saveGroup],
];

describe("support agent gate — agent-only operations", () => {
  for (const [operation, call, effect] of GATED) {
    it(`${operation}: a non-agent is rejected with SupportForbiddenError and nothing is read or written`, async () => {
      const s = setup(MEMBER);
      const err = await call(s).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SupportForbiddenError);
      expect((err as SupportForbiddenError).operation).toBe(operation);
      expect((err as Error).name).toBe("SupportForbiddenError");
      expect(effect(s)).not.toHaveBeenCalled();
      expect(s.store.getTicket).not.toHaveBeenCalled();
    });
  }

  it("an agent passes the gate for every operation", async () => {
    for (const [operation, call] of GATED) {
      const s = setup(AGENT);
      const err = await call(s).catch((e: unknown) => e);
      expect(err, operation).not.toBeInstanceOf(SupportForbiddenError);
    }
  });

  it("requireAgent throws only for a non-agent", () => {
    expect(() => requireAgent({ actor: AGENT }, "x")).not.toThrow();
    expect(() => requireAgent({ actor: MEMBER }, "x")).toThrow(SupportForbiddenError);
  });
});

describe("support agent gate — internal threads and attachments", () => {
  const threads = [thread({ id: "th-public" }), thread({ id: "th-internal", is_internal: true })];
  const attachments = [
    { ...attachment, id: "a-ticket", thread_id: null },
    { ...attachment, id: "a-public", thread_id: "th-public" },
    { ...attachment, id: "a-internal", thread_id: "th-internal" },
  ];

  function withData(actor: SupportActor) {
    const s = setup(actor);
    vi.mocked(s.store.listThreads).mockResolvedValue(threads);
    vi.mocked(s.store.listAttachments).mockResolvedValue(attachments);
    return s;
  }

  it("a non-agent never sees internal threads", async () => {
    const ids = (await withData(MEMBER).service.listThreads("t-1")).map((t) => t.id);
    expect(ids).toEqual(["th-public"]);
  });

  it("an agent sees every thread", async () => {
    const ids = (await withData(AGENT).service.listThreads("t-1")).map((t) => t.id);
    expect(ids).toEqual(["th-public", "th-internal"]);
  });

  it("a non-agent never sees attachments on internal threads", async () => {
    const ids = (await withData(MEMBER).service.listAttachments("t-1")).map((a) => a.id);
    expect(ids).toEqual(["a-ticket", "a-public"]);
  });

  it("an agent sees every attachment", async () => {
    const ids = (await withData(AGENT).service.listAttachments("t-1")).map((a) => a.id);
    expect(ids).toEqual(["a-ticket", "a-public", "a-internal"]);
  });

  it("a non-agent cannot write an internal note, and the store is not called", async () => {
    const s = setup(MEMBER);
    await expect(
      s.service.appendThread({ ticket_id: "t-1", user_id: "user-customer", message: "x", is_internal: true }),
    ).rejects.toBeInstanceOf(SupportForbiddenError);
    expect(s.store.appendThread).not.toHaveBeenCalled();
  });

  it("an agent can write an internal note", async () => {
    const s = setup(AGENT);
    const created = await s.service.appendThread({ ticket_id: "t-1", user_id: "user-agent", message: "x", is_internal: true });
    expect(created.is_internal).toBe(true);
  });
});

describe("support agent gate — requester operations stay open to a non-agent", () => {
  it("lists and reads tickets, creates a ticket, replies publicly, reads categories, groups, links and clocks", async () => {
    const s = setup(MEMBER);
    await expect(s.service.listTickets({})).resolves.toHaveLength(1);
    await expect(s.service.getTicket("t-1")).resolves.not.toBeNull();
    await expect(s.service.createTicket((await s.service.getTicket("t-1"))!, "user-customer")).resolves.toBeTruthy();
    await expect(
      s.service.appendThread({ ticket_id: "t-1", user_id: "user-customer", message: "Any update?" }),
    ).resolves.toBeTruthy();
    await expect(s.service.listCategories()).resolves.toBeTruthy();
    await expect(s.service.listGroups()).resolves.toBeTruthy();
    await expect(s.service.listLinks("t-1")).resolves.toBeTruthy();
    await expect(s.service.getTicketClocks("t-1")).resolves.not.toBeNull();
  });
});
