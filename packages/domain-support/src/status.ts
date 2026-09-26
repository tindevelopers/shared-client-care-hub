/**
 * Ticket status rules (pure).
 *
 * `MANUAL_TRANSITIONS` are the changes an agent can make directly.
 * `waiting_on_upstream` is never set or cleared by hand: only escalating
 * enters it, and only an upstream resolution, a send-back or a withdrawal
 * leaves it (all back to `in_progress`).
 */
import type { TicketStatus } from "./types";

const MANUAL_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ["in_progress", "waiting_on_customer", "resolved", "closed"],
  in_progress: ["waiting_on_customer", "resolved", "closed"],
  waiting_on_customer: ["in_progress", "resolved", "closed"],
  waiting_on_upstream: [],
  resolved: ["in_progress", "closed"],
  closed: [],
};

const ESCALATABLE: ReadonlySet<TicketStatus> = new Set<TicketStatus>([
  "open",
  "in_progress",
  "waiting_on_customer",
]);

/** Statuses in which the problem counts as solved: both clocks stop. */
export const STOPPED_STATUSES: ReadonlySet<TicketStatus> = new Set<TicketStatus>([
  "resolved",
  "closed",
]);

/** Statuses in which the ticket is out of the owner's hands: the owner clock pauses. */
export const WAITING_STATUSES: ReadonlySet<TicketStatus> = new Set<TicketStatus>([
  "waiting_on_customer",
  "waiting_on_upstream",
]);

export function canChangeStatus(from: TicketStatus, to: TicketStatus): boolean {
  return MANUAL_TRANSITIONS[from].includes(to);
}

export function assertStatusChange(from: TicketStatus, to: TicketStatus): void {
  if (!canChangeStatus(from, to)) {
    throw new Error(`A ticket cannot move from "${from}" to "${to}".`);
  }
}

/** Only a ticket its owner is still working on can be escalated. */
export function canEscalate(status: TicketStatus): boolean {
  return ESCALATABLE.has(status);
}
