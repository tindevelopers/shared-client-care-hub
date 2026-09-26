/**
 * Thread operations over the injected store (pure).
 *
 * The first-party thread is always appended first; the reply notification
 * decision follows and can never break the append.
 */
import type { SupportTicketThread } from "./types";
import type { CreateThreadInput, SupportServiceDeps, SupportStore } from "./store";
import { buildTicketReplyNotifications, sendNotifications } from "./notifications";

/** List the threads of a ticket. */
export async function listThreads(
  store: SupportStore,
  ticketId: string,
): Promise<SupportTicketThread[]> {
  return store.listThreads(ticketId);
}

/**
 * Append a reply thread. Notifies the other party: agent replies go to the
 * customer, customer replies to the assignee; internal notes stay silent.
 */
export async function appendThread(
  deps: SupportServiceDeps,
  input: CreateThreadInput,
): Promise<SupportTicketThread> {
  const thread = await deps.store.appendThread(input);

  const ticket = await deps.store.getTicket(input.ticket_id);
  if (ticket) {
    const isAgentReply = input.user_id !== ticket.created_by;
    await sendNotifications(
      deps.notifications,
      buildTicketReplyNotifications(ticket, thread, isAgentReply),
    );
  }

  return thread;
}
