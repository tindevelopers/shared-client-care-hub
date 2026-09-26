/**
 * What happens to linked tickets when an escalated ticket is resolved,
 * sent back, withdrawn or merged (pure planning).
 *
 * The domain decides which links move and what the downstream owner is
 * told; the host's `SupportEscalationGateway` applies each plan
 * atomically, because the rows involved belong to different owners.
 */
import { ownerOf, sameOwner, type SupportTicket, type SupportTicketLink } from "./types";

/** One downstream ticket to hand back to its owner. */
export interface DownstreamUpdate {
  linkId: string;
  downstreamTicketId: string;
  linkState: "resolved" | "returned";
  resolution: string | null;
  /** The downstream ticket always returns to its owner for confirmation. */
  downstreamStatus: "in_progress";
  /** Internal note appended to the downstream ticket. */
  note: string;
}

export interface WithdrawPlan {
  linkId: string;
  upstreamTicketId: string;
  /** Note appended to the upstream ticket as it is closed. */
  note: string;
}

export interface MergePlan {
  duplicateTicketId: string;
  masterTicketId: string;
  /** Active escalation links re-pointed from the duplicate to the master. */
  repointLinkIds: string[];
  /** Note appended to the duplicate as it is closed. */
  note: string;
}

/** Active escalations waiting on `ticketId`. */
export function inboundEscalations(
  links: readonly SupportTicketLink[],
  ticketId: string,
): SupportTicketLink[] {
  return links.filter(
    (l) => l.kind === "escalation" && l.state === "active" && l.to_ticket_id === ticketId,
  );
}

/** The active escalation `ticketId` is waiting on, if any. */
export function outboundEscalation(
  links: readonly SupportTicketLink[],
  ticketId: string,
): SupportTicketLink | undefined {
  return links.find(
    (l) => l.kind === "escalation" && l.state === "active" && l.from_ticket_id === ticketId,
  );
}

/** Upstream resolved: every ticket waiting on it receives the resolution. */
export function planResolution(
  upstream: SupportTicket,
  links: readonly SupportTicketLink[],
  resolution: string,
): DownstreamUpdate[] {
  const text = requireText(resolution, "A resolution");
  return inboundEscalations(links, upstream.id).map((link) => ({
    linkId: link.id,
    downstreamTicketId: link.from_ticket_id,
    linkState: "resolved",
    resolution: text,
    downstreamStatus: "in_progress",
    note: `Upstream ticket ${upstream.ticket_number} was resolved: ${text}`,
  }));
}

/** Upstream sends the escalation back ("not ours", "need more information"). */
export function planReturn(
  upstream: SupportTicket,
  links: readonly SupportTicketLink[],
  reason: string,
): DownstreamUpdate[] {
  const text = requireText(reason, "A reason");
  const inbound = inboundEscalations(links, upstream.id);
  if (inbound.length === 0) {
    throw new Error(`Ticket ${upstream.ticket_number} has no escalation to send back.`);
  }
  return inbound.map((link) => ({
    linkId: link.id,
    downstreamTicketId: link.from_ticket_id,
    linkState: "returned",
    resolution: null,
    downstreamStatus: "in_progress",
    note: `Upstream ticket ${upstream.ticket_number} was sent back: ${text}`,
  }));
}

/** The downstream owner takes its escalation back (e.g. it solved the problem itself). */
export function planWithdraw(
  downstream: SupportTicket,
  links: readonly SupportTicketLink[],
  reason?: string,
): WithdrawPlan {
  const link = outboundEscalation(links, downstream.id);
  if (!link || !link.to_ticket_id) {
    throw new Error(`Ticket ${downstream.ticket_number} has no active escalation to withdraw.`);
  }
  const why = reason?.trim();
  return {
    linkId: link.id,
    upstreamTicketId: link.to_ticket_id,
    note: `Escalation from ticket ${downstream.ticket_number} was withdrawn${why ? `: ${why}` : "."}`,
  };
}

/**
 * Merge a duplicate into a master owned by the same owner. The duplicate's
 * waiting escalations move to the master, so resolving the master reaches
 * every original downstream ticket.
 */
export function planMerge(
  duplicate: SupportTicket,
  master: SupportTicket,
  duplicateLinks: readonly SupportTicketLink[],
): MergePlan {
  if (duplicate.id === master.id) {
    throw new Error("A ticket cannot be merged into itself.");
  }
  if (!sameOwner(ownerOf(duplicate), ownerOf(master))) {
    throw new Error("Only tickets in the same queue can be merged.");
  }
  if (duplicate.status === "closed") {
    throw new Error(`Ticket ${duplicate.ticket_number} is already closed.`);
  }
  if (duplicate.status === "waiting_on_upstream") {
    throw new Error(
      `Ticket ${duplicate.ticket_number} is escalated itself; withdraw that escalation before merging.`,
    );
  }
  if (master.status === "resolved" || master.status === "closed") {
    throw new Error(`Ticket ${master.ticket_number} is ${master.status}; reopen it before merging into it.`);
  }
  return {
    duplicateTicketId: duplicate.id,
    masterTicketId: master.id,
    repointLinkIds: inboundEscalations(duplicateLinks, duplicate.id).map((l) => l.id),
    note: `Merged into ticket ${master.ticket_number}.`,
  };
}

function requireText(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}
