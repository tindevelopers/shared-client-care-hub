/**
 * Support ticket policy (pure).
 *
 * The outcome of a support conversation decides whether a first-party
 * ticket must exist. Apps never duplicate this decision — they receive it
 * from the domain and compose their stores around it.
 */

/** Canonical result of a support conversation. */
export type SupportOutcome =
  | "resolved"
  | "ticket_requested"
  | "human_handoff"
  | "operations_escalation"
  | "policy_required";

/** Outcomes that require a first-party ticket to be created. */
const TICKET_OUTCOMES: ReadonlySet<SupportOutcome> = new Set<SupportOutcome>([
  "ticket_requested",
  "human_handoff",
  "operations_escalation",
]);

/**
 * True when the outcome requires a first-party ticket: an explicit request,
 * a human handoff, or an Operations escalation. A resolved FAQ needs no
 * ticket; a policy-required conversation must be accepted before one is.
 */
export function shouldCreateSupportTicket(outcome: SupportOutcome): boolean {
  return TICKET_OUTCOMES.has(outcome);
}
