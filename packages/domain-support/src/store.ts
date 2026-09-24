/**
 * Support store contract and service composition (pure).
 *
 * `SupportStore` is the ONLY storage seam of the support domain:
 * `createSupportStore(client, tenantId)` (see `./stores`) is the concrete,
 * injected implementation against Supabase, and `createSupportService(deps)`
 * composes every ticket, thread, attachment, and category operation on top
 * of whichever `SupportStore` is injected. This module itself never touches
 * a database client.
 */
import type {
  SupportCategory,
  SupportTicket,
  SupportTicketAttachment,
  SupportTicketThread,
  TicketPriority,
  TicketStatus,
  UpdateTicketInput,
} from "./types.js";
import type { CreateSupportTicketInput } from "./stores/ticket-store.js";
import type { SupportNotificationSender } from "./notifications.js";
import { createTicket, getTicket, listTickets, updateTicket } from "./tickets.js";
import { appendThread, listThreads } from "./threads.js";
import { listAttachments } from "./attachments.js";
import { deleteCategory, listCategories, saveCategory } from "./categories.js";

export type {
  SupportCategory,
  SupportTicket,
  SupportTicketAttachment,
  SupportTicketThread,
  TicketPriority,
  TicketStatus,
  UpdateTicketInput,
};

/** Ticket list filters. The store is tenant-scoped by construction. */
export interface SupportTicketQuery {
  status?: TicketStatus;
  priority?: TicketPriority;
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

/**
 * The injected storage contract. `createSupportStore(client, tenantId)` (see
 * `./stores`) is the reference implementation against Supabase; a test may
 * inject a fake instead.
 *
 * `getTicket`/`createTicket`/`listTickets` implementations SHOULD populate
 * the optional `created_by_user`/`assigned_to_user` joins (as
 * `createSupportTicketStore` does) or notification personalization silently
 * degrades to generic greetings.
 */
export interface SupportStore {
  listTickets(query: SupportTicketQuery): Promise<SupportTicket[]>;
  getTicket(id: string): Promise<SupportTicket | null>;
  createTicket(input: CreateSupportTicketInput): Promise<SupportTicket>;
  updateTicket(id: string, input: UpdateTicketInput): Promise<SupportTicket>;
  listThreads(ticketId: string): Promise<SupportTicketThread[]>;
  appendThread(input: CreateThreadInput): Promise<SupportTicketThread>;
  listAttachments(ticketId: string): Promise<SupportTicketAttachment[]>;
  listCategories(): Promise<SupportCategory[]>;
  saveCategory(input: SaveCategoryInput): Promise<SupportCategory>;
  deleteCategory(id: string): Promise<void>;
}

export interface SupportServiceDeps {
  store: SupportStore;
  notifications: SupportNotificationSender;
  /** Best-effort specialist-desk sync; must never block the tenant. */
  syncDeskBestEffort(ticket: SupportTicket): Promise<void>;
}

export interface SupportService {
  listTickets(query: SupportTicketQuery): Promise<SupportTicket[]>;
  getTicket(id: string): Promise<SupportTicket | null>;
  createTicket(input: CreateSupportTicketInput): Promise<SupportTicket>;
  updateTicket(ticketId: string, input: UpdateTicketInput): Promise<SupportTicket | null>;
  listThreads(ticketId: string): Promise<SupportTicketThread[]>;
  appendThread(input: CreateThreadInput): Promise<SupportTicketThread>;
  listAttachments(ticketId: string): Promise<SupportTicketAttachment[]>;
  listCategories(): Promise<SupportCategory[]>;
  saveCategory(input: SaveCategoryInput): Promise<SupportCategory>;
  deleteCategory(id: string): Promise<void>;
}

/** Compose the support service from injected effects only. */
export function createSupportService(deps: SupportServiceDeps): SupportService {
  return {
    listTickets: (query) => listTickets(deps.store, query),
    getTicket: (id) => getTicket(deps.store, id),
    createTicket: (input) => createTicket(deps, input),
    updateTicket: (ticketId, input) => updateTicket(deps, ticketId, input),
    listThreads: (ticketId) => listThreads(deps.store, ticketId),
    appendThread: (input) => appendThread(deps, input),
    listAttachments: (ticketId) => listAttachments(deps.store, ticketId),
    listCategories: () => listCategories(deps.store),
    saveCategory: (input) => saveCategory(deps.store, input),
    deleteCategory: (id) => deleteCategory(deps.store, id),
  };
}
