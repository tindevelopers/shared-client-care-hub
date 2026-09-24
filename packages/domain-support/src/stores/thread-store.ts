import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupportTicketThread } from "../types.js";

/**
 * Tenant-tier support ticket thread store, ported from
 * `@tindevelopers/core-kernel/support/threads`. Injection-only: `user_id` is
 * an explicit argument on `create`, never resolved from a request session.
 */

const THREAD_SELECT = `
  *,
  user:users!support_ticket_threads_user_id_fkey(id, full_name, email, avatar_url)
`;

export interface ListThreadsOptions {
  includeInternal?: boolean;
}

export interface CreateSupportThreadInput {
  ticket_id: string;
  user_id: string;
  message: string;
  is_internal?: boolean;
}

export interface UpdateSupportThreadInput {
  message?: string;
  is_internal?: boolean;
}

export interface SupportThreadStore {
  list(ticketId: string, options?: ListThreadsOptions): Promise<SupportTicketThread[]>;
  get(id: string): Promise<SupportTicketThread | null>;
  create(input: CreateSupportThreadInput): Promise<SupportTicketThread>;
  update(id: string, input: UpdateSupportThreadInput): Promise<SupportTicketThread>;
  remove(id: string): Promise<void>;
}

export function createSupportThreadStore(client: SupabaseClient, tenantId: string): SupportThreadStore {
  const threads = () => client.from("support_ticket_threads") as any;
  const tickets = () => client.from("support_tickets") as any;

  return {
    async list(ticketId, options) {
      let q = threads()
        .select(THREAD_SELECT)
        .eq("ticket_id", ticketId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true });

      if (!options?.includeInternal) {
        q = q.eq("is_internal", false);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data as SupportTicketThread[]) ?? [];
    },

    async get(id) {
      const { data, error } = await threads()
        .select(THREAD_SELECT)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data as SupportTicketThread;
    },

    async create(input) {
      const { data: ticket } = await tickets()
        .select("id")
        .eq("id", input.ticket_id)
        .eq("tenant_id", tenantId)
        .single();
      if (!ticket) {
        throw new Error("Ticket not found");
      }

      const { data, error } = await threads()
        .insert({
          ticket_id: input.ticket_id,
          tenant_id: tenantId,
          user_id: input.user_id,
          message: input.message,
          is_internal: input.is_internal ?? false,
        })
        .select(THREAD_SELECT)
        .single();
      if (error) throw error;
      return data as SupportTicketThread;
    },

    async update(id, input) {
      const updateData: Record<string, unknown> = {};
      if (input.message !== undefined) updateData.message = input.message;
      if (input.is_internal !== undefined) updateData.is_internal = input.is_internal;

      const { data, error } = await threads()
        .update(updateData)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select(THREAD_SELECT)
        .single();
      if (error) throw error;
      return data as SupportTicketThread;
    },

    async remove(id) {
      const { error } = await threads().delete().eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;
    },
  };
}
