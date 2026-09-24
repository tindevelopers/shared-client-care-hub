import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateTicketInput, SupportTicket, UpdateTicketInput } from "../types.js";
import type { SupportTicketQuery } from "../store.js";

/**
 * Tenant-tier support ticket store — the concrete, injected implementation of
 * ticket storage, ported from `@tindevelopers/core-kernel/support/tickets`.
 *
 * Every method binds to the injected `tenantId` explicitly (defense in depth
 * alongside whatever RLS the caller's client carries — the pattern
 * `domain-contacts`' `createContactsStore` uses). Identity is never resolved
 * here: `create` takes `created_by` as an explicit argument instead of
 * reading `supabase.auth.getUser()`, so the store never assumes a request
 * session — the host resolves the actor and injects it (injection-only,
 * R2). `id`, `ticket_number`, `created_at`, and `updated_at` are DB-owned
 * (UUID default, the `set_support_ticket_number` trigger, and column
 * defaults respectively) — the store never synthesizes them.
 */

const TICKET_SELECT = `
  *,
  category:support_categories(*),
  created_by_user:users!support_tickets_created_by_fkey(id, full_name, email, avatar_url),
  assigned_to_user:users!support_tickets_assigned_to_fkey(id, full_name, email, avatar_url)
`;

export interface CreateSupportTicketInput extends CreateTicketInput {
  /** The actor creating the ticket — resolved and injected by the host. */
  created_by: string;
}

export interface SupportTicketStats {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
  pending: number; // open + in_progress
  solved: number; // resolved + closed
}

export interface SupportTicketStore {
  list(query?: SupportTicketQuery): Promise<SupportTicket[]>;
  get(id: string): Promise<SupportTicket | null>;
  getByNumber(ticketNumber: string): Promise<SupportTicket | null>;
  create(input: CreateSupportTicketInput): Promise<SupportTicket>;
  update(id: string, input: UpdateTicketInput): Promise<SupportTicket>;
  remove(id: string): Promise<void>;
  stats(): Promise<SupportTicketStats>;
}

export function createSupportTicketStore(client: SupabaseClient, tenantId: string): SupportTicketStore {
  const table = () => client.from("support_tickets") as any;
  const categories = () => client.from("support_categories") as any;

  // category_id is host-supplied; a foreign key only proves the row exists
  // somewhere, not that it belongs to this tenant (TICKET_SELECT embeds
  // category:support_categories(*), so an unchecked id would let a
  // service-role client link and read another tenant's category).
  async function assertCategoryBelongsToTenant(categoryId: string) {
    const { data } = await categories()
      .select("id")
      .eq("id", categoryId)
      .eq("tenant_id", tenantId)
      .single();
    if (!data) {
      throw new Error("Category not found");
    }
  }

  return {
    async list(query = {}) {
      let q = table()
        .select(TICKET_SELECT)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      if (query.status) q = q.eq("status", query.status);
      if (query.priority) q = q.eq("priority", query.priority);
      if (query.assigned_to) q = q.eq("assigned_to", query.assigned_to);
      if (query.created_by) q = q.eq("created_by", query.created_by);
      if (query.category_id) q = q.eq("category_id", query.category_id);

      const { data, error } = await q;
      if (error) throw error;
      return (data as SupportTicket[]) ?? [];
    },

    async get(id) {
      const { data, error } = await table()
        .select(TICKET_SELECT)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data as SupportTicket;
    },

    async getByNumber(ticketNumber) {
      const { data, error } = await table()
        .select(TICKET_SELECT)
        .eq("ticket_number", ticketNumber)
        .eq("tenant_id", tenantId)
        .single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data as SupportTicket;
    },

    async create(input) {
      if (input.category_id) {
        await assertCategoryBelongsToTenant(input.category_id);
      }

      const { data, error } = await table()
        .insert({
          tenant_id: tenantId,
          subject: input.subject,
          description: input.description || null,
          priority: input.priority ?? "medium",
          category_id: input.category_id || null,
          created_by: input.created_by,
          assigned_to: input.assigned_to || null,
          support_code: input.support_code || null,
          support_ref: input.support_ref || null,
        })
        .select(TICKET_SELECT)
        .single();
      if (error) throw error;
      return data as SupportTicket;
    },

    async update(id, input) {
      if (input.category_id) {
        await assertCategoryBelongsToTenant(input.category_id);
      }

      const updateData: Record<string, unknown> = {};
      if (input.subject !== undefined) updateData.subject = input.subject;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.priority !== undefined) updateData.priority = input.priority;
      if (input.category_id !== undefined) updateData.category_id = input.category_id;
      if (input.assigned_to !== undefined) updateData.assigned_to = input.assigned_to;
      if (input.escalated_to_platform_admin_at !== undefined) {
        updateData.escalated_to_platform_admin_at = input.escalated_to_platform_admin_at;
      }

      const { data, error } = await table()
        .update(updateData)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select(TICKET_SELECT)
        .single();
      if (error) throw error;
      return data as SupportTicket;
    },

    async remove(id) {
      const { error } = await table().delete().eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;
    },

    async stats() {
      const { data, error } = await table().select("status").eq("tenant_id", tenantId);
      if (error) throw error;

      const rows = (data as Array<{ status: string }>) ?? [];
      const stats: SupportTicketStats = {
        total: rows.length,
        open: rows.filter((t) => t.status === "open").length,
        in_progress: rows.filter((t) => t.status === "in_progress").length,
        resolved: rows.filter((t) => t.status === "resolved").length,
        closed: rows.filter((t) => t.status === "closed").length,
        pending: 0,
        solved: 0,
      };
      stats.pending = stats.open + stats.in_progress;
      stats.solved = stats.resolved + stats.closed;
      return stats;
    },
  };
}
