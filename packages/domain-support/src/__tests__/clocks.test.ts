import { describe, expect, it } from "vitest";
import { computeTicketClocks } from "../clocks";

const HOUR = 3_600_000;

describe("computeTicketClocks", () => {
  it("matches the agreed worked example: customer 2 days 5 hours, owner 4.5 hours", () => {
    // Mon 09:00 opened; 12:00 asked the customer; 12:30 customer replied;
    // 13:00 escalated to the partner; Wed 13:00 partner resolved; Wed 14:00 closed.
    const clocks = computeTicketClocks({
      createdAt: "2026-01-05T09:00:00Z",
      events: [
        { status: "in_progress", at: "2026-01-05T10:00:00Z" },
        { status: "waiting_on_customer", at: "2026-01-05T12:00:00Z" },
        { status: "in_progress", at: "2026-01-05T12:30:00Z" },
        { status: "waiting_on_upstream", at: "2026-01-05T13:00:00Z" },
        { status: "in_progress", at: "2026-01-07T13:00:00Z" },
        { status: "closed", at: "2026-01-07T14:00:00Z" },
      ],
      now: "2026-01-20T00:00:00Z",
    });
    expect(clocks.customerMs).toBe(53 * HOUR);
    expect(clocks.ownerMs).toBe(4.5 * HOUR);
  });

  it("keeps running for a ticket that is still open", () => {
    const clocks = computeTicketClocks({
      createdAt: "2026-01-05T09:00:00Z",
      events: [],
      now: "2026-01-05T11:00:00Z",
    });
    expect(clocks).toEqual({ customerMs: 2 * HOUR, ownerMs: 2 * HOUR });
  });

  it("stops while resolved and resumes when the requester reopens", () => {
    const clocks = computeTicketClocks({
      createdAt: "2026-01-05T09:00:00Z",
      events: [
        { status: "resolved", at: "2026-01-05T10:00:00Z" },
        { status: "in_progress", at: "2026-01-06T10:00:00Z" },
        { status: "closed", at: "2026-01-06T11:00:00Z" },
      ],
      now: "2026-01-10T00:00:00Z",
    });
    expect(clocks).toEqual({ customerMs: 2 * HOUR, ownerMs: 2 * HOUR });
  });

  it("pauses the owner clock for every escalation, not just the first", () => {
    const clocks = computeTicketClocks({
      createdAt: "2026-01-05T09:00:00Z",
      events: [
        { status: "waiting_on_upstream", at: "2026-01-05T10:00:00Z" },
        { status: "in_progress", at: "2026-01-05T12:00:00Z" },
        { status: "waiting_on_upstream", at: "2026-01-05T13:00:00Z" },
        { status: "in_progress", at: "2026-01-05T17:00:00Z" },
      ],
      now: "2026-01-05T18:00:00Z",
    });
    expect(clocks).toEqual({ customerMs: 9 * HOUR, ownerMs: 3 * HOUR });
  });

  it("does not depend on the order events arrive in", () => {
    const events = [
      { status: "closed" as const, at: "2026-01-05T12:00:00Z" },
      { status: "waiting_on_customer" as const, at: "2026-01-05T10:00:00Z" },
    ];
    const clocks = computeTicketClocks({
      createdAt: "2026-01-05T09:00:00Z",
      events,
      now: "2026-01-06T00:00:00Z",
    });
    expect(clocks).toEqual({ customerMs: 3 * HOUR, ownerMs: 1 * HOUR });
  });

  it("rejects an invalid timestamp", () => {
    expect(() =>
      computeTicketClocks({ createdAt: "not a date", events: [], now: "2026-01-05T09:00:00Z" }),
    ).toThrow("Invalid timestamp");
  });
});
