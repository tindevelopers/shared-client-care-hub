/**
 * Support store contract and service composition (pure).
 *
 * `SupportStore` is the storage seam for ONE owner (a tenant, a partner or
 * the platform): the host implements it against any database, bound to the
 * acting owner, and it never reads or writes another owner's rows.
 * The only cross-owner writer is `SupportEscalationGateway`, which applies
 * escalation plans atomically after authorizing the actor.
 * `createSupportService(deps)` composes every operation on top of these
 * seams; the domain itself never touches a database client.
 *
 * The service enforces the support-agent rule itself: agent-only operations
 * throw `SupportForbiddenError` for a non-agent `actor`, and a non-agent never
 * sees internal threads or their attachments. The host decides `isAgent`
 * (for example from the `support.agent` permission); the database enforces
 * the same rule independently.
 */
import type { UpstreamTicketDraft, SupportOwnerChain, EscalationShareChoices } from "./escalation";
import type { DownstreamUpdate, MergePlan, WithdrawPlan } from "./propagation";
import type { SupportNotificationSender } from "./notifications";
import type { TicketClocks } from "./clocks";
import type {
  EscalationShared,
  SupportCategory,
  SupportGroup,
  SupportStatusEvent,
  SupportTicket,
  SupportTicketAttachment,
  SupportTicketLink,
  SupportTicketThread,
  TicketPriority,
  TicketStatus,
  UpdateTicketInput,
} from "./types";
import { createTicket, getTicket, getTicketClocks, listTickets, updateTicket } from "./tickets";
import { appendThread, listThreads } from "./threads";
import { listAttachments } from "./attachments";
import { deleteCategory, listCategories, saveCategory } from "./categories";
import {
  escalateTicket,
  mergeTickets,
  resolveTicket,
  returnEscalation,
  withdrawEscalation,
} from "./escalation-workflow";

/** Ticket list filters. The store is owner-scoped by construction. */
export interface SupportTicketQuery {
  status?: TicketStatus;
  priority?: TicketPriority;
  group_id?: string;
  assigned_to?: string;
  created_by?: string;
  category_id?: string;
}

/** Thread append input — the domain never resolves identity itself. */
export interface CreateThreadInput {
  ticket_id: string;
  user_id: string;
  message: string;
  is_internal?: boolean;
}

/** Category upsert input: present `id` updates, absent `id` creates. */
export interface SaveCategoryInput {
  id?: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

/** Support group upsert input: present `id` updates, absent `id` creates. */
export interface SaveGroupInput {
  id?: string;
  name: string;
  rank: number;
  is_active?: boolean;
}

/**
 * The injected storage contract for one owner — implemented by the host.
 *
 * `getTicket`/`saveTicket`/`listTickets` implementations SHOULD populate the
 * optional `created_by_user`/`assigned_to_user` joins, or notification
 * personalization degrades to generic greetings and requester contact
 * cannot be shared on escalation.
 */
export interface SupportStore {
  listTickets(query: SupportTicketQuery): Promise<SupportTicket[]>;
  getTicket(id: string): Promise<SupportTicket | null>;
  /**
   * The host owns identifier synthesis (`id`, `ticket_number`, timestamps)
   * before create, and records `actorId` as the author of every history row.
   */
  saveTicket(ticket: SupportTicket, actorId: string): Promise<SupportTicket>;
  listThreads(ticketId: string): Promise<SupportTicketThread[]>;
  appendThread(input: CreateThreadInput): Promise<SupportTicketThread>;
  listAttachments(ticketId: string): Promise<SupportTicketAttachment[]>;
  listCategories(): Promise<SupportCategory[]>;
  saveCategory(input: SaveCategoryInput): Promise<SupportCategory>;
  deleteCategory(id: string): Promise<void>;
  listGroups(): Promise<SupportGroup[]>;
  saveGroup(input: SaveGroupInput): Promise<SupportGroup>;
  /** Links where the ticket is either end (both ends may read a link row). */
  listLinks(ticketId: string): Promise<SupportTicketLink[]>;
  /** Status changes from the ticket history, for the clocks. */
  listStatusEvents(ticketId: string): Promise<SupportStatusEvent[]>;
}

/**
 * The only cross-owner writer — implemented by the host with elevated
 * database access. Every method first checks that `actorId` belongs to the
 * owner performing the action, runs in one transaction, and writes an audit
 * row.
 */
export interface SupportEscalationGateway {
  /**
   * Insert the upstream ticket in the target owner's queue (with `threads`
   * as internal notes and copies of `attachment_ids`), insert an active
   * escalation link carrying `shared`, and move the downstream ticket to
   * `waiting_on_upstream`. Actor: a member of the downstream owner.
   */
  createUpstreamTicket(input: {
    downstreamTicketId: string;
    draft: UpstreamTicketDraft;
    shared: EscalationShared;
    actorId: string;
  }): Promise<{ upstreamTicket: SupportTicket; link: SupportTicketLink }>;
  /**
   * For each update: set the link's state, resolution and `closed_at`, move
   * the downstream ticket to `downstreamStatus`, and append `note` to it as
   * an internal note. Actor: a member of the upstream owner. Returns the
   * updated downstream tickets.
   */
  handBack(input: { updates: DownstreamUpdate[]; actorId: string }): Promise<SupportTicket[]>;
  /**
   * Mark the link withdrawn and close the upstream ticket with `note`.
   * Must refuse when the upstream ticket has its own active escalation.
   * Actor: a member of the downstream owner.
   */
  withdraw(input: { plan: WithdrawPlan; actorId: string }): Promise<void>;
  /**
   * Re-point `repointLinkIds` to the master, record a merge link from the
   * duplicate to the master, and close the duplicate with `note`.
   * Actor: a member of the owner of both tickets.
   */
  merge(input: { plan: MergePlan; actorId: string }): Promise<void>;
}

/** Who is calling the service. The host resolves `isAgent`; the domain never reads roles. */
export interface SupportActor {
  id: string;
  /** Holds the `support.agent` permission for this owner. */
  isAgent: boolean;
}

/** An agent-only operation was attempted by a non-agent. */
export class SupportForbiddenError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`support: ${operation} requires a support agent`);
    this.name = "SupportForbiddenError";
    this.operation = operation;
  }
}

export interface SupportServiceDeps {
  /** The caller; required so no host can forget the agent rule. */
  actor: SupportActor;
  store: SupportStore;
  notifications: SupportNotificationSender;
  ownerChain: SupportOwnerChain;
  escalations: SupportEscalationGateway;
  /** Best-effort specialist-desk sync; must never block the owner. */
  syncDeskBestEffort(ticket: SupportTicket): Promise<void>;
}

export interface EscalateTicketInput {
  actorId: string;
  /** Display name of the escalating owner, shown upstream. */
  fromOwnerLabel: string;
  choices?: EscalationShareChoices;
}

export interface SupportService {
  listTickets(query: SupportTicketQuery): Promise<SupportTicket[]>;
  getTicket(id: string): Promise<SupportTicket | null>;
  createTicket(ticket: SupportTicket, actorId: string): Promise<SupportTicket>;
  updateTicket(ticketId: string, input: UpdateTicketInput, actorId: string): Promise<SupportTicket | null>;
  listThreads(ticketId: string): Promise<SupportTicketThread[]>;
  appendThread(input: CreateThreadInput): Promise<SupportTicketThread>;
  listAttachments(ticketId: string): Promise<SupportTicketAttachment[]>;
  listCategories(): Promise<SupportCategory[]>;
  saveCategory(input: SaveCategoryInput): Promise<SupportCategory>;
  deleteCategory(id: string): Promise<void>;
  listGroups(): Promise<SupportGroup[]>;
  saveGroup(input: SaveGroupInput): Promise<SupportGroup>;
  listLinks(ticketId: string): Promise<SupportTicketLink[]>;
  /** Customer and owner clocks; `now` defaults to the current time. */
  getTicketClocks(ticketId: string, now?: string): Promise<TicketClocks | null>;
  escalateTicket(
    ticketId: string,
    input: EscalateTicketInput,
  ): Promise<{ upstreamTicket: SupportTicket; link: SupportTicketLink }>;
  resolveTicket(ticketId: string, input: { actorId: string; resolution: string }): Promise<SupportTicket>;
  returnEscalation(ticketId: string, input: { actorId: string; reason: string }): Promise<SupportTicket>;
  withdrawEscalation(ticketId: string, input: { actorId: string; reason?: string }): Promise<SupportTicket>;
  mergeTickets(duplicateId: string, masterId: string, input: { actorId: string }): Promise<void>;
}

/** Throws `SupportForbiddenError` unless the actor is a support agent. */
export function requireAgent(deps: Pick<SupportServiceDeps, "actor">, operation: string): void {
  if (!deps.actor.isAgent) throw new SupportForbiddenError(operation);
}

/** Wraps an operation so it runs only for an agent; the store is never touched otherwise. */
function agentOnly<A extends unknown[], R>(
  deps: SupportServiceDeps,
  operation: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args) => {
    requireAgent(deps, operation);
    return fn(...args);
  };
}

/** Compose the support service from injected effects only. */
export function createSupportService(deps: SupportServiceDeps): SupportService {
  const agent = deps.actor.isAgent;
  return {
    listTickets: (query) => listTickets(deps.store, query),
    getTicket: (id) => getTicket(deps.store, id),
    createTicket: (ticket, actorId) => createTicket(deps, ticket, actorId),
    updateTicket: agentOnly(deps, "updateTicket", (ticketId: string, input: UpdateTicketInput, actorId: string) =>
      updateTicket(deps, ticketId, input, actorId),
    ),
    listThreads: async (ticketId) => {
      const threads = await listThreads(deps.store, ticketId);
      return agent ? threads : threads.filter((t) => !t.is_internal);
    },
    appendThread: async (input) => {
      if (input.is_internal) requireAgent(deps, "appendThread(is_internal)");
      return appendThread(deps, input);
    },
    listAttachments: async (ticketId) => {
      const attachments = await listAttachments(deps.store, ticketId);
      if (agent || !attachments.some((a) => a.thread_id)) return attachments;
      const internal = new Set(
        (await deps.store.listThreads(ticketId)).filter((t) => t.is_internal).map((t) => t.id),
      );
      return attachments.filter((a) => !a.thread_id || !internal.has(a.thread_id));
    },
    listCategories: () => listCategories(deps.store),
    saveCategory: agentOnly(deps, "saveCategory", (input: SaveCategoryInput) => saveCategory(deps.store, input)),
    deleteCategory: agentOnly(deps, "deleteCategory", (id: string) => deleteCategory(deps.store, id)),
    listGroups: () => deps.store.listGroups(),
    saveGroup: agentOnly(deps, "saveGroup", (input: SaveGroupInput) => deps.store.saveGroup(input)),
    listLinks: (ticketId) => deps.store.listLinks(ticketId),
    getTicketClocks: (ticketId, now) => getTicketClocks(deps.store, ticketId, now),
    escalateTicket: agentOnly(deps, "escalateTicket", (ticketId: string, input: EscalateTicketInput) =>
      escalateTicket(deps, ticketId, input),
    ),
    resolveTicket: agentOnly(deps, "resolveTicket", (ticketId: string, input: { actorId: string; resolution: string }) =>
      resolveTicket(deps, ticketId, input),
    ),
    returnEscalation: agentOnly(deps, "returnEscalation", (ticketId: string, input: { actorId: string; reason: string }) =>
      returnEscalation(deps, ticketId, input),
    ),
    withdrawEscalation: agentOnly(
      deps,
      "withdrawEscalation",
      (ticketId: string, input: { actorId: string; reason?: string }) => withdrawEscalation(deps, ticketId, input),
    ),
    mergeTickets: agentOnly(deps, "mergeTickets", (duplicateId: string, masterId: string, input: { actorId: string }) =>
      mergeTickets(deps, duplicateId, masterId, input),
    ),
  };
}
