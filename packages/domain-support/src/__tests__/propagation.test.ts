import { describe, expect, it } from "vitest";
import {
  inboundEscalations,
  outboundEscalation,
  planMerge,
  planResolution,
  planReturn,
  planWithdraw,
} from "../propagation";
import { PARTNER, link, ticket } from "./fixtures";

const upstream = ticket({ ...PARTNER, id: "t-up", ticket_number: "TKT-UP" });

describe("planResolution", () => {
  it("hands the resolution to every active escalation waiting on the ticket, once each", () => {
    const links = [
      link({ id: "l-1", from_ticket_id: "t-a", to_ticket_id: "t-up" }),
      link({ id: "l-2", from_ticket_id: "t-b", to_ticket_id: "t-up" }),
      link({ id: "l-3", from_ticket_id: "t-c", to_ticket_id: "t-up", state: "resolved" }),
      link({ id: "l-4", from_ticket_id: "t-d", to_ticket_id: "t-other" }),
      link({ id: "l-5", kind: "merge", from_ticket_id: "t-dup", to_ticket_id: "t-up" }),
    ];
    const updates = planResolution(upstream, links, "  Carrier fixed the route ");
    expect(updates).toEqual([
      {
        linkId: "l-1",
        downstreamTicketId: "t-a",
        linkState: "resolved",
        resolution: "Carrier fixed the route",
        downstreamStatus: "in_progress",
        note: "Upstream ticket TKT-UP was resolved: Carrier fixed the route",
      },
      expect.objectContaining({ linkId: "l-2", downstreamTicketId: "t-b" }),
    ]);
  });

  it("returns nothing to hand back when no one is waiting", () => {
    expect(planResolution(upstream, [], "Fixed")).toEqual([]);
  });

  it("requires a resolution", () => {
    expect(() => planResolution(upstream, [], " ")).toThrow("A resolution is required");
  });
});

describe("planReturn", () => {
  it("sends every waiting escalation back with the reason", () => {
    const updates = planReturn(upstream, [link({ to_ticket_id: "t-up" })], "Need the account number");
    expect(updates).toEqual([
      expect.objectContaining({
        linkState: "returned",
        resolution: null,
        downstreamStatus: "in_progress",
        note: "Upstream ticket TKT-UP was sent back: Need the account number",
      }),
    ]);
  });

  it("rejects a ticket no one escalated", () => {
    expect(() => planReturn(upstream, [], "no")).toThrow("no escalation to send back");
  });

  it("requires a reason", () => {
    expect(() => planReturn(upstream, [link({ to_ticket_id: "t-up" })], "")).toThrow("A reason is required");
  });
});

describe("planWithdraw", () => {
  const downstream = ticket({ id: "t-1", status: "waiting_on_upstream" });

  it("closes the upstream ticket with a note naming the withdrawn escalation", () => {
    const plan = planWithdraw(downstream, [link({ id: "l-7", from_ticket_id: "t-1", to_ticket_id: "t-up" })], "Solved");
    expect(plan).toEqual({ linkId: "l-7", upstreamTicketId: "t-up", note: "Escalation from ticket TKT-1 was withdrawn: Solved" });
  });

  it("rejects a ticket with no active escalation", () => {
    expect(() => planWithdraw(downstream, [link({ from_ticket_id: "t-1", state: "resolved" })])).toThrow(
      "no active escalation",
    );
  });
});

describe("planMerge", () => {
  const master = ticket({ ...PARTNER, id: "t-master", ticket_number: "TKT-M", status: "in_progress" });
  const duplicate = ticket({ ...PARTNER, id: "t-dup", ticket_number: "TKT-D" });

  it("moves the duplicate's waiting escalations to the master", () => {
    const plan = planMerge(duplicate, master, [
      link({ id: "l-1", to_ticket_id: "t-dup" }),
      link({ id: "l-2", to_ticket_id: "t-dup", state: "returned" }),
    ]);
    expect(plan).toEqual({
      duplicateTicketId: "t-dup",
      masterTicketId: "t-master",
      repointLinkIds: ["l-1"],
      note: "Merged into ticket TKT-M.",
    });
  });

  it("only merges tickets in the same queue", () => {
    expect(() => planMerge(ticket({ id: "t-dup" }), master, [])).toThrow("same queue");
    expect(() => planMerge(master, master, [])).toThrow("into itself");
  });

  it("rejects closed duplicates, escalated duplicates and finished masters", () => {
    expect(() => planMerge({ ...duplicate, status: "closed" }, master, [])).toThrow("already closed");
    expect(() => planMerge({ ...duplicate, status: "waiting_on_upstream" }, master, [])).toThrow("withdraw");
    expect(() => planMerge(duplicate, { ...master, status: "resolved" }, [])).toThrow("reopen it");
  });
});

describe("link selectors", () => {
  it("find inbound and outbound active escalations only", () => {
    const links = [
      link({ id: "in", from_ticket_id: "t-a", to_ticket_id: "t-1" }),
      link({ id: "out", from_ticket_id: "t-1", to_ticket_id: "t-up" }),
      link({ id: "old", from_ticket_id: "t-1", to_ticket_id: "t-up2", state: "withdrawn" }),
    ];
    expect(inboundEscalations(links, "t-1").map((l) => l.id)).toEqual(["in"]);
    expect(outboundEscalation(links, "t-1")?.id).toBe("out");
  });
});
