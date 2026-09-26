/**
 * Ticket clocks (pure), computed from status history — nothing ticks.
 *
 * - Customer clock: how long the requester has waited. Counts every moment
 *   the ticket is not resolved or closed.
 * - Owner clock: how long this owner has spent on its part. Also pauses
 *   while waiting on the customer or on an upstream escalation.
 *
 * Each escalated ticket has its own pair, so every owner is measured on the
 * time it actually held the ticket.
 */
import { STOPPED_STATUSES, WAITING_STATUSES } from "./status";
import type { SupportStatusEvent, TicketStatus } from "./types";

export interface TicketClocks {
  customerMs: number;
  ownerMs: number;
}

export interface ComputeTicketClocksInput {
  createdAt: string;
  /** Status changes after creation; order does not matter. */
  events: readonly SupportStatusEvent[];
  /** End of the measurement for a ticket that is still running. */
  now: string;
  /** Status at creation; defaults to "open". */
  initialStatus?: TicketStatus;
}

export function computeTicketClocks(input: ComputeTicketClocksInput): TicketClocks {
  const start = toMs(input.createdAt);
  const end = toMs(input.now);
  const events = input.events
    .map((e) => ({ status: e.status, at: Math.min(Math.max(toMs(e.at), start), end) }))
    .sort((a, b) => a.at - b.at);

  let status: TicketStatus = input.initialStatus ?? "open";
  let from = start;
  const clocks: TicketClocks = { customerMs: 0, ownerMs: 0 };

  for (const event of [...events, { status, at: end }]) {
    const span = event.at - from;
    if (!STOPPED_STATUSES.has(status)) {
      clocks.customerMs += span;
      if (!WAITING_STATUSES.has(status)) clocks.ownerMs += span;
    }
    status = event.status;
    from = event.at;
  }
  return clocks;
}

function toMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Invalid timestamp "${iso}".`);
  return ms;
}
