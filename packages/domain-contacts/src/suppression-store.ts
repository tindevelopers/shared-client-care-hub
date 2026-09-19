import type { SupabaseClient } from "@supabase/supabase-js";
type SuppressionChannel = "email" | "sms" | "whatsapp";
export type ContactSuppressionRow = {
  id: string;
  tenant_id: string;
  contact_id: string;
  channel: SuppressionChannel;
  suppressed: boolean;
  reason: string | null;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type QueryResult = { data: unknown; error: unknown };
interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns: string): QueryBuilder;
  upsert(values: unknown, options: Record<string, unknown>): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  single(): Promise<QueryResult>;
}

export type ContactSuppressionSet = {
  channel: SuppressionChannel;
  suppressed: boolean;
  reason: string | null;
  source: string;
  metadata?: Record<string, unknown>;
  updatedBy: string;
};

export interface ContactSuppressionStore {
  list(contactId?: string): Promise<ContactSuppressionRow[]>;
  set(contactId: string, input: ContactSuppressionSet): Promise<ContactSuppressionRow>;
  setMany(
    contactIds: string[],
    input: ContactSuppressionSet,
  ): Promise<ContactSuppressionRow[]>;
}

export function createContactSuppressionStore(
  client: SupabaseClient,
  tenantId: string,
): ContactSuppressionStore {
  const table = () =>
    client.from("contact_suppressions") as unknown as QueryBuilder;
  const payload = (contactId: string, input: ContactSuppressionSet) => ({
    tenant_id: tenantId,
    contact_id: contactId,
    channel: input.channel,
    suppressed: input.suppressed,
    reason: input.reason,
    source: input.source,
    metadata: { ...(input.metadata ?? {}), updated_by: input.updatedBy },
  });

  return {
    async list(contactId) {
      let query = table().select("*").eq("tenant_id", tenantId);
      if (contactId) query = query.eq("contact_id", contactId);
      const { data, error } = await query.order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContactSuppressionRow[];
    },

    async set(contactId, input) {
      const { data, error } = await table()
        .upsert(payload(contactId, input), {
          onConflict: "tenant_id,contact_id,channel",
        })
        .eq("tenant_id", tenantId)
        .select("*")
        .single();
      if (error) throw error;
      return data as ContactSuppressionRow;
    },

    async setMany(contactIds, input) {
      if (contactIds.length === 0) return [];
      const { data, error } = await table()
        .upsert(contactIds.map((contactId) => payload(contactId, input)), {
          onConflict: "tenant_id,contact_id,channel",
        })
        .eq("tenant_id", tenantId)
        .select("*");
      if (error) throw error;
      return (data ?? []) as ContactSuppressionRow[];
    },
  };
}
