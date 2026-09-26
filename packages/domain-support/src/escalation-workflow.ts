/**
 * Escalation workflow over the injected store, owner chain and gateway.
 *
 * Every operation validates first, writes the acting owner's own ticket
 * through its store, and hands cross-owner effects to the gateway. Each
 * operation is safe to retry: a step already applied is skipped.
 */
import type { EscalateTicketInput, SupportServiceDeps, SupportStore } from "./store";
import type { SupportTicket, SupportTicketLink } from "./types";
import { ownerOf } from "./types";
import { assertStatusChange, canEscalate } from "./status";
import { buildUpstreamTicket, selectEscalationTarget } from "./escalation";
import {
  outboundEscalation,
  planMerge,
  planResolution,
  planReturn,
  planWithdraw,
} from "./propagation";
import {
  buildTicketEscalatedNotifications,
  buildTicketReturnedNotifications,
  buildTicketUpdatedNotifications,
  buildUpstreamResolvedNotifications,
  sendNotifications,
} from "./notifications";

/** Escalate to the next owner up the chain; the ticket waits on the new upstream ticket. */
export async function escalateTicket(
  deps: SupportServiceDeps,
  ticketId: string,
  input: EscalateTicketInput,
): Promise<{ upstreamTicket: SupportTicket; link: SupportTicketLink }> {
  const ticket = await requireTicket(deps.store, ticketId);
  if (!canEscalate(ticket.status)) {
    throw new Error(`Ticket ${ticket.ticket_number} is ${ticket.status} and cannot be escalated.`);
  }
  const current = ownerOf(ticket);
  const target = selectEscalationTarget(current, await deps.ownerChain.parentOf(current));
  const [threads, attachments] = await Promise.all([
    deps.store.listThreads(ticketId),
    deps.store.listAttachments(ticketId),
  ]);
  const { draft, shared } = buildUpstreamTicket({
    ticket,
    threads,
    attachments,
    target,
    actorId: input.actorId,
    fromOwnerLabel: input.fromOwnerLabel,
    choices: input.choices,
  });

  const result = await deps.escalations.createUpstreamTicket({
    downstreamTicketId: ticket.id,
    draft,
    shared,
    actorId: input.actorId,
  });
  await sendNotifications(
    deps.notifications,
    buildTicketEscalatedNotifications(result.upstreamTicket, input.fromOwnerLabel),
  );
  return result;
}

/** Resolve a ticket and send the resolution to every ticket waiting on it. */
export async function resolveTicket(
  deps: SupportServiceDeps,
  ticketId: string,
  input: { actorId: string; resolution: string },
): Promise<SupportTicket> {
  const ticket = await requireTicket(deps.store, ticketId);
  const updates = planResolution(ticket, await deps.store.listLinks(ticketId), input.resolution);

  let saved = ticket;
  if (ticket.status !== "resolved") {
    assertStatusChange(ticket.status, "resolved");
    saved = await deps.store.saveTicket({ ...ticket, status: "resolved" }, input.actorId);
    await sendNotifications(
      deps.notifications,
      buildTicketUpdatedNotifications(saved, { status: "resolved" }),
    );
  }

  if (updates.length > 0) {
    const downstream = await deps.escalations.handBack({ updates, actorId: input.actorId });
    const resolution = updates[0].resolution ?? "";
    await sendNotifications(
      deps.notifications,
      downstream.flatMap((d) => buildUpstreamResolvedNotifications(d, saved.ticket_number, resolution)),
    );
  }
  return saved;
}

/** Send an escalation back to the owner(s) waiting on this ticket, and close it. */
export async function returnEscalation(
  deps: SupportServiceDeps,
  ticketId: string,
  input: { actorId: string; reason: string },
): Promise<SupportTicket> {
  const ticket = await requireTicket(deps.store, ticketId);
  const updates = planReturn(ticket, await deps.store.listLinks(ticketId), input.reason);
  if (ticket.status === "waiting_on_upstream") {
    throw new Error(
      `Ticket ${ticket.ticket_number} is escalated itself; withdraw that escalation before sending this one back.`,
    );
  }

  let saved = ticket;
  if (ticket.status !== "closed") {
    assertStatusChange(ticket.status, "closed");
    saved = await deps.store.saveTicket({ ...ticket, status: "closed" }, input.actorId);
  }

  const downstream = await deps.escalations.handBack({ updates, actorId: input.actorId });
  const reason = input.reason.trim();
  await sendNotifications(
    deps.notifications,
    downstream.flatMap((d) => buildTicketReturnedNotifications(d, saved.ticket_number, reason)),
  );
  return saved;
}

/** Take an escalation back; the upstream ticket is closed and this ticket resumes. */
export async function withdrawEscalation(
  deps: SupportServiceDeps,
  ticketId: string,
  input: { actorId: string; reason?: string },
): Promise<SupportTicket> {
  const ticket = await requireTicket(deps.store, ticketId);
  if (ticket.status !== "waiting_on_upstream") {
    throw new Error(`Ticket ${ticket.ticket_number} is not waiting on an escalation.`);
  }
  const links = await deps.store.listLinks(ticketId);
  if (outboundEscalation(links, ticketId)) {
    const plan = planWithdraw(ticket, links, input.reason);
    await deps.escalations.withdraw({ plan, actorId: input.actorId });
  }
  return deps.store.saveTicket({ ...ticket, status: "in_progress" }, input.actorId);
}

/** Merge a duplicate into a master in the same queue. */
export async function mergeTickets(
  deps: SupportServiceDeps,
  duplicateId: string,
  masterId: string,
  input: { actorId: string },
): Promise<void> {
  const [duplicate, master] = await Promise.all([
    requireTicket(deps.store, duplicateId),
    requireTicket(deps.store, masterId),
  ]);
  const plan = planMerge(duplicate, master, await deps.store.listLinks(duplicateId));
  await deps.escalations.merge({ plan, actorId: input.actorId });
}

async function requireTicket(store: SupportStore, ticketId: string): Promise<SupportTicket> {
  const ticket = await store.getTicket(ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} was not found.`);
  return ticket;
}
