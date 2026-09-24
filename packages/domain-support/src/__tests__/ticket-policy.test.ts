import { describe, expect, it } from "vitest";
import { shouldCreateSupportTicket, type SupportOutcome } from "../ticket-policy";

describe("shouldCreateSupportTicket", () => {
  const cases: ReadonlyArray<[SupportOutcome, boolean]> = [
    ["resolved", false],
    ["policy_required", false],
    ["ticket_requested", true],
    ["human_handoff", true],
    ["operations_escalation", true],
  ];

  it.each(cases)("outcome %s creates a ticket: %s", (outcome, expected) => {
    expect(shouldCreateSupportTicket(outcome)).toBe(expected);
  });
});
