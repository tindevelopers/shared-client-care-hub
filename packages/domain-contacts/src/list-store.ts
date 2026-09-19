import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactRow } from "@tindevelopers/schema-crm";

type ContactListKind = "list" | "segment";
type ContactSegmentDefinition = { tags?: string[] };
export type ContactGroupRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  kind: ContactListKind;
  definition: ContactSegmentDefinition | null;
};

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
        .eq("tenant_id", tenantId)
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
      const rows = contactIds.map((contactId) => ({
        tenant_id: tenantId,
        group_id: groupId,
        contact_id: contactId,
      }));
      const { data, error } = await table("contact_group_members")
        .upsert(rows, { onConflict: "group_id,contact_id", ignoreDuplicates: true })
        .eq("tenant_id", tenantId)
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
