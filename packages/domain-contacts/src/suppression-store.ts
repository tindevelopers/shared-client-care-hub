import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ContactSuppressionInsert,
  ContactSuppressionRow,
  SuppressionChannel,
} from "@tindevelopers/schema-crm";
import { ContactNotFoundError } from "./errors.js";

type QueryResult = { data: unknown; error: unknown };
interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns: string): QueryBuilder;
  upsert(values: unknown, options: Record<string, unknown>): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  in(column: string, values: readonly unknown[]): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

export type ContactSuppressionSet = {
  channel: SuppressionChannel;
  suppressed: boolean;
  reason: string | null;
  source: string;
  metadata?: Record<string, unknown>;
  /** Acting user persisted in the canonical `updated_by` column (null = system). */
  updatedBy: string | null;
};

export interface ContactSuppressionStore {
  list(contactId?: string): Promise<ContactSuppressionRow[]>;
  set(contactId: string, input: ContactSuppressionSet): Promise<ContactSuppressionRow>;
  setMany(
    contactIds: string[],
    input: ContactSuppressionSet,
  ): Promise<ContactSuppressionRow[]>;
}

/**
 * Canonical suppression store — the single tenant-tier writer of
 * `contact_suppressions`.
 *
 * Writes upsert on the canonical identity `(tenant_id, contact_id, channel)`
 * and persist reason, source, metadata, and the acting user in the dedicated
 * `updated_by` column (no metadata convention). Legacy contact flags
 * (`email_opt_out` / `sms_opt_out` / `whatsapp_opt_out`) are projected by the
 * DB trigger `project_contact_suppression_to_contacts`; this store never
 * writes them.
 *
 * Cross-tenant contact ids are a provable zero effect: `set` rejects with
 * {@link ContactNotFoundError} and `setMany` narrows to tenant-owned contacts
 * before the upsert (the composite FK `(tenant_id, contact_id) → contacts`
 * is the DB-side second line of defense).
 */
export function createContactSuppressionStore(
  client: SupabaseClient,
  tenantId: string,
): ContactSuppressionStore {
  const table = () =>
    client.from("contact_suppressions") as unknown as QueryBuilder;
  const contacts = () => client.from("contacts") as unknown as QueryBuilder;

  const payload = (
    contactId: string,
    input: ContactSuppressionSet,
  ): ContactSuppressionInsert => ({
    tenant_id: tenantId,
    contact_id: contactId,
    channel: input.channel,
    suppressed: input.suppressed,
    reason: input.reason,
    source: input.source,
    metadata: input.metadata ?? {},
    updated_by: input.updatedBy,
  });

  /** Ids from `contactIds` that belong to this tenant, in input order. */
  async function tenantOwnedContactIds(contactIds: string[]): Promise<string[]> {
    const { data, error } = await contacts()
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", contactIds);
    if (error) throw error;
    const owned = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    return contactIds.filter((id) => owned.has(id));
  }

  return {
    async list(contactId) {
      let query = table().select("*").eq("tenant_id", tenantId);
      if (contactId) query = query.eq("contact_id", contactId);
      const { data, error } = await query.order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContactSuppressionRow[];
    },

    async set(contactId, input) {
      const { data: contact, error: contactError } = await contacts()
        .select("id")
        .eq("id", contactId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (contactError) throw contactError;
      if (!contact) {
        throw new ContactNotFoundError(`Contact ${contactId} not found.`);
      }

      const { data, error } = await table()
        .upsert(payload(contactId, input), {
          onConflict: "tenant_id,contact_id,channel",
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as ContactSuppressionRow;
    },

    async setMany(contactIds, input) {
      if (contactIds.length === 0) return [];
      const ownedContactIds = await tenantOwnedContactIds(contactIds);
      if (ownedContactIds.length === 0) return [];
      const { data, error } = await table()
        .upsert(ownedContactIds.map((contactId) => payload(contactId, input)), {
          onConflict: "tenant_id,contact_id,channel",
        })
        .select("*");
      if (error) throw error;
      return (data ?? []) as ContactSuppressionRow[];
    },
  };
}
