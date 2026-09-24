import type { SupabaseClient } from "@supabase/supabase-js";
import type { SaveCategoryInput, SupportStore } from "../store.js";
import { createSupportTicketStore } from "./ticket-store.js";
import { createSupportThreadStore } from "./thread-store.js";
import { createSupportAttachmentStore } from "./attachment-store.js";
import { createSupportCategoryStore } from "./category-store.js";

/**
 * Compose the four table-scoped stores into the `SupportStore` contract
 * `createSupportService` (see `../store.ts`) depends on — the single
 * injected-client entry point for the whole support data layer.
 */
export function createSupportStore(client: SupabaseClient, tenantId: string): SupportStore {
  const tickets = createSupportTicketStore(client, tenantId);
  const threads = createSupportThreadStore(client, tenantId);
  const attachments = createSupportAttachmentStore(client, tenantId);
  const categories = createSupportCategoryStore(client, tenantId);

  return {
    listTickets: (query) => tickets.list(query),
    getTicket: (id) => tickets.get(id),
    createTicket: (input) => tickets.create(input),
    updateTicket: (id, input) => tickets.update(id, input),
    listThreads: (ticketId) => threads.list(ticketId),
    appendThread: (input) => threads.create(input),
    listAttachments: (ticketId) => attachments.list(ticketId),
    listCategories: () => categories.list(),
    saveCategory: (input: SaveCategoryInput) =>
      input.id ? categories.update(input.id, input) : categories.create(input),
    deleteCategory: (id) => categories.remove(id),
  };
}
