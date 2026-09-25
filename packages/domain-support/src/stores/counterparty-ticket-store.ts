import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PartnerSupportTicketPriority,
  PartnerSupportTicketReplyRow,
  PartnerSupportTicketRow,
  PartnerSupportTicketStatus,
} from "@tindevelopers/schema-support";

/**
 * Counterparty (partner) support ticket store — a partner's own ticket queue
 * with the platform, scoped by `partnerId`, not `tenantId`. This is a
 * genuinely different actor relationship from the tenant-scoped
 * `createSupportTicketStore` (an agency filing a ticket with the platform,
 * vs. a tenant's end customer filing one with the tenant) and is a
 * deliberately separate, distinct top-level entry point — it is not
 * composed into `createSupportStore`/`SupportStore`.
 *
 * Every method binds to the injected `partnerId` explicitly (defense in
 * depth alongside RLS), and identity is never resolved here: `create` takes
 * `created_by` as an explicit argument, matching `createSupportTicketStore`.
 * `id`, `created_at`, and `updated_at` are DB-owned (UUID default, column
 * defaults, and the `updated_at` trigger) — the store never synthesizes
 * them.
 */

export type CounterpartyTicket = PartnerSupportTicketRow;
export type CounterpartyTicketReply = PartnerSupportTicketReplyRow;

export interface CounterpartyTicketQuery {
  status?: PartnerSupportTicketStatus;
  priority?: PartnerSupportTicketPriority;
  tenant_id?: string;
}

export interface CreateCounterpartyTicketInput {
  subject: string;
  details?: string;
  priority?: PartnerSupportTicketPriority;
  tenant_id?: string | null;
  /** The actor creating the ticket — resolved and injected by the host. */
  created_by: string;
}

export interface UpdateCounterpartyTicketInput {
  subject?: string;
  details?: string;
  priority?: PartnerSupportTicketPriority;
  status?: PartnerSupportTicketStatus;
  tenant_id?: string | null;
}

export interface CreateCounterpartyTicketReplyInput {
  ticket_id: string;
  /** The actor authoring the reply — resolved and injected by the host. */
  author_user_id: string;
  body: string;
}

export interface CounterpartyTicketReplyStore {
  list(ticketId: string): Promise<CounterpartyTicketReply[]>;
  create(input: CreateCounterpartyTicketReplyInput): Promise<CounterpartyTicketReply>;
}

export interface CounterpartyTicketStore {
  list(query?: CounterpartyTicketQuery): Promise<CounterpartyTicket[]>;
  get(id: string): Promise<CounterpartyTicket | null>;
  create(input: CreateCounterpartyTicketInput): Promise<CounterpartyTicket>;
  update(id: string, input: UpdateCounterpartyTicketInput): Promise<CounterpartyTicket>;
  remove(id: string): Promise<void>;
  replies: CounterpartyTicketReplyStore;
}

export function createCounterpartyTicketStore(
  client: SupabaseClient,
  partnerId: string,
): CounterpartyTicketStore {
  const tickets = () => client.from("partner_support_tickets") as any;
  const replies = () => client.from("partner_support_ticket_replies") as any;

  // partner_support_ticket_replies has no partner_id column of its own —
  // scoping runs through the parent ticket, so verify it belongs to this
  // partner before any read or write against its replies.
  async function assertTicketBelongsToPartner(ticketId: string) {
    const { data } = await tickets().select("id").eq("id", ticketId).eq("partner_id", partnerId).single();
    if (!data) {
      throw new Error("Ticket not found");
    }
  }

  return {
    async list(query = {}) {
      let q = tickets()
        .select("*")
        .eq("partner_id", partnerId)
        .order("updated_at", { ascending: false });

      if (query.status) q = q.eq("status", query.status);
      if (query.priority) q = q.eq("priority", query.priority);
      if (query.tenant_id) q = q.eq("tenant_id", query.tenant_id);

      const { data, error } = await q;
      if (error) throw error;
      return (data as CounterpartyTicket[]) ?? [];
    },

    async get(id) {
      const { data, error } = await tickets()
        .select("*")
        .eq("id", id)
        .eq("partner_id", partnerId)
        .single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data as CounterpartyTicket;
    },

    async create(input) {
      const { data, error } = await tickets()
        .insert({
          partner_id: partnerId,
          tenant_id: input.tenant_id || null,
          subject: input.subject,
          details: input.details || "",
          priority: input.priority ?? "medium",
          created_by: input.created_by,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as CounterpartyTicket;
    },

    async update(id, input) {
      const updateData: Record<string, unknown> = {};
      if (input.subject !== undefined) updateData.subject = input.subject;
      if (input.details !== undefined) updateData.details = input.details;
      if (input.priority !== undefined) updateData.priority = input.priority;
      if (input.status !== undefined) updateData.status = input.status;
      if (input.tenant_id !== undefined) updateData.tenant_id = input.tenant_id || null;

      const { data, error } = await tickets()
        .update(updateData)
        .eq("id", id)
        .eq("partner_id", partnerId)
        .select("*")
        .single();
      if (error) throw error;
      return data as CounterpartyTicket;
    },

    async remove(id) {
      const { error } = await tickets().delete().eq("id", id).eq("partner_id", partnerId);
      if (error) throw error;
    },

    replies: {
      async list(ticketId) {
        await assertTicketBelongsToPartner(ticketId);
        const { data, error } = await replies()
          .select("*")
          .eq("ticket_id", ticketId)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return (data as CounterpartyTicketReply[]) ?? [];
      },

      async create(input) {
        await assertTicketBelongsToPartner(input.ticket_id);
        const { data, error } = await replies()
          .insert({
            ticket_id: input.ticket_id,
            author_user_id: input.author_user_id,
            body: input.body,
          })
          .select("*")
          .single();
        if (error) throw error;
        return data as CounterpartyTicketReply;
      },
    },
  };
}
