import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ContactGroupRow,
  ContactListKind,
  ContactRow,
  ContactSegmentDefinition,
} from "@tindevelopers/schema-crm";

type QueryResult = { data: unknown; error: unknown; count?: number | null };
interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns: string): QueryBuilder;
  insert(values: unknown): QueryBuilder;
  update(values: unknown): QueryBuilder;
  delete(): QueryBuilder;
  upsert(values: unknown, options: Record<string, unknown>): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  in(column: string, values: readonly unknown[]): QueryBuilder;
  contains(column: string, value: unknown): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

export type ContactListCreate = {
  name: string;
  description?: string | null;
  color?: string | null;
  created_by?: string | null;
  kind?: ContactListKind;
  definition?: ContactSegmentDefinition | null;
};

export type ContactListUpdate = Partial<
  Pick<ContactGroupRow, "name" | "description" | "color" | "kind" | "definition">
>;

export type ContactSegmentPreview = Record<string, unknown> & {
  tags?: string[];
  lifecycleStage?: string;
  contactGroupId?: string;
  customFields?: Record<string, unknown>;
};

export class UnsupportedSegmentFilterError extends Error {
  readonly filters: string[];

  constructor(filters: string[]) {
    super(`Unsupported segment filters: ${filters.join(", ")}.`);
    this.name = "UnsupportedSegmentFilterError";
    this.filters = filters;
  }
}

export interface ContactListsStore {
  list(): Promise<ContactGroupRow[]>;
  get(id: string): Promise<ContactGroupRow | null>;
  create(input: ContactListCreate): Promise<ContactGroupRow>;
  update(id: string, patch: ContactListUpdate): Promise<ContactGroupRow | null>;
  remove(id: string): Promise<{ deleted: number }>;
  addMembers(groupId: string, contactIds: string[]): Promise<{ inserted: number }>;
  removeMembers(groupId: string, contactIds: string[]): Promise<{ deleted: number }>;
  listContacts(groupId: string): Promise<ContactRow[]>;
  previewSegment(definition: ContactSegmentPreview): Promise<ContactRow[]>;
}

const SUPPORTED_SEGMENT_FILTERS = new Set([
  "tags",
  "lifecycleStage",
  "contactGroupId",
  "customFields",
]);

/**
 * Tenant-tier contact lists (contact_groups) + membership store.
 *
 * The Supabase client is injected; the store never constructs one and binds
 * every group, member, and contact query to `tenantId`.
 *
 * Membership tenant consistency is enforced twice:
 * - store-side: `addMembers` verifies the group exists in this tenant and
 *   narrows contact ids to this tenant's contacts BEFORE the upsert, so
 *   cross-tenant group/contact ids are a provable zero-effect no-op;
 * - DB-side: composite FKs on contact_group_members pin (tenant_id, group_id)
 *   and (tenant_id, contact_id) (20260919010000 migration).
 */
export function createContactListsStore(
  client: SupabaseClient,
  tenantId: string,
): ContactListsStore {
  const table = (name: string) => client.from(name) as unknown as QueryBuilder;

  async function memberContactIds(groupId: string): Promise<string[]> {
    const { data, error } = await table("contact_group_members")
      .select("contact_id")
      .eq("tenant_id", tenantId)
      .eq("group_id", groupId);
    if (error) throw error;
    return [
      ...new Set(
        ((data ?? []) as Array<{ contact_id: string }>).map((row) => row.contact_id),
      ),
    ];
  }

  /** Ids from `contactIds` that belong to this tenant, in input order. */
  async function tenantOwnedContactIds(contactIds: string[]): Promise<string[]> {
    const { data, error } = await table("contacts")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", contactIds);
    if (error) throw error;
    const owned = new Set(
      ((data ?? []) as Array<{ id: string }>).map((row) => row.id),
    );
    return contactIds.filter((id) => owned.has(id));
  }

  return {
    async list() {
      const { data, error } = await table("contact_groups")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContactGroupRow[];
    },

    async get(id) {
      const { data, error } = await table("contact_groups")
        .select("*")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return (data as ContactGroupRow | null) ?? null;
    },

    async create(input) {
      const { data, error } = await table("contact_groups")
        .insert({ ...input, tenant_id: tenantId })
        .select("*")
        .single();
      if (error) throw error;
      return data as ContactGroupRow;
    },

    async update(id, patch) {
      const { data, error } = await table("contact_groups")
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return (data as ContactGroupRow | null) ?? null;
    },

    async remove(id) {
      const { data, error, count } = await table("contact_groups")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select("id");
      if (error) throw error;
      return { deleted: Array.isArray(data) ? data.length : (count ?? 0) };
    },

    async addMembers(groupId, contactIds) {
      if (contactIds.length === 0) return { inserted: 0 };

      // Zero effect unless the group itself belongs to this tenant.
      const { data: group, error: groupError } = await table("contact_groups")
        .select("id")
        .eq("id", groupId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (groupError) throw groupError;
      if (!group) return { inserted: 0 };

      // Zero effect for cross-tenant contact ids: only tenant-owned contacts
      // reach the upsert (DB composite FKs are the second line of defense).
      const ownedContactIds = await tenantOwnedContactIds(contactIds);
      if (ownedContactIds.length === 0) return { inserted: 0 };

      const rows = ownedContactIds.map((contactId) => ({
        tenant_id: tenantId,
        group_id: groupId,
        contact_id: contactId,
      }));
      // ignoreDuplicates: existing memberships are not re-inserted, so the
      // returned row count is exactly the number of newly inserted members.
      const { data, error } = await table("contact_group_members")
        .upsert(rows, { onConflict: "group_id,contact_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      return { inserted: Array.isArray(data) ? data.length : 0 };
    },

    async removeMembers(groupId, contactIds) {
      if (contactIds.length === 0) return { deleted: 0 };
      const { data, error, count } = await table("contact_group_members")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("group_id", groupId)
        .in("contact_id", contactIds)
        .select("id");
      if (error) throw error;
      return { deleted: Array.isArray(data) ? data.length : (count ?? 0) };
    },

    async listContacts(groupId) {
      const contactIds = await memberContactIds(groupId);
      if (contactIds.length === 0) return [];
      const { data, error } = await table("contacts")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("id", contactIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContactRow[];
    },

    async previewSegment(definition) {
      const unsupported = Object.keys(definition).filter(
        (key) => !SUPPORTED_SEGMENT_FILTERS.has(key),
      );
      if (unsupported.length > 0) throw new UnsupportedSegmentFilterError(unsupported);

      let contactIds: string[] | undefined;
      if (definition.contactGroupId) {
        contactIds = await memberContactIds(definition.contactGroupId);
        if (contactIds.length === 0) return [];
      }

      let query = table("contacts").select("*").eq("tenant_id", tenantId);
      if (definition.tags?.length) query = query.contains("tags", definition.tags);

      // The hosted schema has no contacts.lifecycle_stage column; the stage
      // filter is only supported as an explicit custom_fields entry.
      const customFields = {
        ...(definition.customFields ?? {}),
        ...(definition.lifecycleStage
          ? { lifecycle_stage: definition.lifecycleStage }
          : {}),
      };
      if (Object.keys(customFields).length > 0) {
        query = query.contains("custom_fields", customFields);
      }
      if (contactIds) query = query.in("id", contactIds);

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContactRow[];
    },
  };
}
