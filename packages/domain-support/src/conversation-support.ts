/**
 * Conversation-to-ticket handoff persistence (pure orchestration).
 *
 * The canonical conversation and the first-party ticket are persisted
 * BEFORE any best-effort specialist-desk synchronization (design rule:
 * ours is the system of record). Every effect is an injected dependency —
 * the host owns storage, identity, and desk wiring.
 */
import type { CreateTicketInput } from "./types.js";
import { shouldCreateSupportTicket, type SupportOutcome } from "./ticket-policy.js";

export interface ConversationSupportInput {
  /** Host-shaped canonical conversation draft to persist. */
  conversation: Record<string, unknown>;
  outcome: SupportOutcome;
  /** Ticket draft, used only when the outcome requires a ticket. */
  ticket: CreateTicketInput;
}

export interface ConversationSupportDeps {
  persistConversation(conversation: Record<string, unknown>): Promise<string>;
  createTicket(input: CreateTicketInput & { conversationId: string }): Promise<string>;
  syncDeskBestEffort(ticketId: string): Promise<void>;
}

/**
 * Persist the conversation, create the first-party ticket when the outcome
 * requires one, then trigger best-effort desk sync — always in that order.
 */
export async function persistSupportHandoff(
  deps: ConversationSupportDeps,
  input: ConversationSupportInput,
): Promise<{ conversationId: string; ticketId?: string }> {
  const conversationId = await deps.persistConversation(input.conversation);
  const ticketId = shouldCreateSupportTicket(input.outcome)
    ? await deps.createTicket({ ...input.ticket, conversationId })
    : undefined;
  if (ticketId) await deps.syncDeskBestEffort(ticketId);
  return { conversationId, ticketId };
}
