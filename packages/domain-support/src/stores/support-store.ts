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
    listAttachments: async (ticketId) => {
      // listThreads() already hides internal threads; an attachment on one
      // must be hidden the same way, so cross-reference the tenant-scoped
      // thread store rather than trusting attachments.list() (which returns
      // everything for agent-side callers).
      const allThreads = await threads.list(ticketId, { includeInternal: true });
      const items = await attachments.list(ticketId);
      const internalThreadIds = new Set(allThreads.filter((t) => t.is_internal).map((t) => t.id));
      return items.filter((a) => !a.thread_id || !internalThreadIds.has(a.thread_id));
    },
    listCategories: () => categories.list(),
    saveCategory: (input: SaveCategoryInput) =>
      input.id ? categories.update(input.id, input) : categories.create(input),
    deleteCategory: (id) => categories.remove(id),
  };
}
