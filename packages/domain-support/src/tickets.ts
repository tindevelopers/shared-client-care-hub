/**
 * Ticket operations over the injected store (pure).
 *
 * First-party write first, notifications second (failures isolated), desk
 * sync best-effort last — a specialist outage never blocks the owner.
 */
import type { SupportServiceDeps, SupportStore, SupportTicketQuery } from "./store";
import type { SupportTicket, UpdateTicketInput } from "./types";
import {
  buildTicketCreatedNotifications,
  buildTicketUpdatedNotifications,
  sendNotifications,
  type SupportTicketChanges,
} from "./notifications";
import { assertStatusChange } from "./status";
import { inboundEscalations } from "./propagation";
import { computeTicketClocks, type TicketClocks } from "./clocks";

/** List tickets for the owner the store is bound to. */
export async function listTickets(
  store: SupportStore,
  query: SupportTicketQuery,
): Promise<SupportTicket[]> {
  return store.listTickets(query);
}

/** Get a ticket by id. */
export async function getTicket(
  store: SupportStore,
  ticketId: string,
): Promise<SupportTicket | null> {
  return store.getTicket(ticketId);
}

/**
 * Create a support ticket. The first-party write always happens and always
 * comes first; notification transport failures and desk sync failures can
 * never break ticket creation.
 */
export async function createTicket(
  deps: SupportServiceDeps,
  ticket: SupportTicket,
  actorId: string,
): Promise<SupportTicket> {
  const saved = await deps.store.saveTicket(ticket, actorId);
  await sendNotifications(deps.notifications, buildTicketCreatedNotifications(saved));
  await syncDeskBestEffort(deps, saved);
  return saved;
}

/**
 * Update a support ticket: validates any status change, merges the defined
 * input fields onto the stored row, then notifies tracked changes. A ticket
 * that escalated tickets are waiting on cannot be resolved or closed here:
 * use `resolveTicket` (sends the resolution down) or `returnEscalation`.
 */
export async function updateTicket(
  deps: SupportServiceDeps,
  ticketId: string,
  input: UpdateTicketInput,
  actorId: string,
): Promise<SupportTicket | null> {
  const oldTicket = await deps.store.getTicket(ticketId);
  if (!oldTicket) return null;

  if (input.status !== undefined && input.status !== oldTicket.status) {
    assertStatusChange(oldTicket.status, input.status);
    if (input.status === "resolved" || input.status === "closed") {
      const waiting = inboundEscalations(await deps.store.listLinks(ticketId), ticketId);
      if (waiting.length > 0) {
        throw new Error(
          `${waiting.length} escalated ticket(s) are waiting on ticket ${oldTicket.ticket_number}; resolve it with a resolution or send them back.`,
        );
      }
    }
  }

  const merged: SupportTicket = { ...oldTicket, ...definedFields(input) };
  const saved = await deps.store.saveTicket(merged, actorId);

  const changes: SupportTicketChanges = {};
  if (input.status && oldTicket.status !== input.status) changes.status = input.status;
  if (input.priority && oldTicket.priority !== input.priority) changes.priority = input.priority;
  if (input.assigned_to !== undefined && oldTicket.assigned_to !== input.assigned_to) {
    changes.assigned_to = input.assigned_to;
  }
  await sendNotifications(deps.notifications, buildTicketUpdatedNotifications(saved, changes));

  return saved;
}

/** Customer and owner clocks from the ticket's status history. */
export async function getTicketClocks(
  store: SupportStore,
  ticketId: string,
  now: string = new Date().toISOString(),
): Promise<TicketClocks | null> {
  const ticket = await store.getTicket(ticketId);
  if (!ticket) return null;
  const events = await store.listStatusEvents(ticketId);
  return computeTicketClocks({ createdAt: ticket.created_at, events, now });
}

async function syncDeskBestEffort(
  deps: SupportServiceDeps,
  ticket: SupportTicket,
): Promise<void> {
  try {
    await deps.syncDeskBestEffort(ticket);
  } catch (error) {
    console.error(`Best-effort desk sync failed for ticket ${ticket.id}:`, error);
  }
}

function definedFields<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
