/**
 * Ticket operations over the injected store (pure).
 *
 * First-party write first, notifications second (failures isolated), desk
 * sync best-effort last — a specialist outage never blocks the tenant.
 */
import type { UpdateTicketInput } from "./types.js";
import type { CreateSupportTicketInput } from "./stores/ticket-store.js";
import type {
  SupportServiceDeps,
  SupportStore,
  SupportTicket,
  SupportTicketQuery,
} from "./store.js";
import {
  buildTicketCreatedNotifications,
  buildTicketEscalatedNotifications,
  buildTicketUpdatedNotifications,
  sendNotifications,
  type SupportTicketChanges,
} from "./notifications.js";

/** List tickets for the tenant the store is bound to. */
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
  input: CreateSupportTicketInput,
): Promise<SupportTicket> {
  const saved = await deps.store.createTicket(input);
  await sendNotifications(deps.notifications, buildTicketCreatedNotifications(saved));
  await syncDeskBestEffort(deps, saved);
  return saved;
}

/**
 * Update a support ticket: merges the input onto the stored row via the
 * store, then emits escalation and change notifications for tracked fields.
 */
export async function updateTicket(
  deps: SupportServiceDeps,
  ticketId: string,
  input: UpdateTicketInput,
): Promise<SupportTicket | null> {
  const oldTicket = await deps.store.getTicket(ticketId);
  if (!oldTicket) return null;

  const saved = await deps.store.updateTicket(ticketId, input);

  if (input.escalated_to_platform_admin_at && !oldTicket.escalated_to_platform_admin_at) {
    await sendNotifications(deps.notifications, buildTicketEscalatedNotifications(saved));
  }

  const changes: SupportTicketChanges = {};
  if (input.status && oldTicket.status !== input.status) changes.status = input.status;
  if (input.priority && oldTicket.priority !== input.priority) changes.priority = input.priority;
  if (input.assigned_to !== undefined && oldTicket.assigned_to !== input.assigned_to) {
    changes.assigned_to = input.assigned_to;
  }
  await sendNotifications(deps.notifications, buildTicketUpdatedNotifications(saved, changes));

  return saved;
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
