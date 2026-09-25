import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CustomFieldDefinitionInsert,
  CustomFieldDefinitionRow,
  CustomFieldDefinitionUpdate,
  CustomFieldEntity,
} from "@tindevelopers/schema-crm";

/**
 * Tenant-tier custom field definition store, ported from
 * `apps/ops/app/actions/crm/custom-fields.ts`. Admin-configuration-style CRUD
 * for per-tenant extra fields on contacts/companies/deals — the same shape
 * as `deal-stage-store`, not linked to a specific record. No cross-tenant
 * reference check is needed: the only host-supplied foreign key is
 * `tenant_id` itself, which every method already scopes by.
 */

export type CreateCustomFieldInput = Omit<CustomFieldDefinitionInsert, "tenant_id">;
export type UpdateCustomFieldInput = Omit<
  CustomFieldDefinitionUpdate,
  "id" | "tenant_id" | "entity" | "key" | "created_at" | "updated_at"
>;

export interface CustomFieldStore {
  list(entity?: CustomFieldEntity): Promise<CustomFieldDefinitionRow[]>;
  get(id: string): Promise<CustomFieldDefinitionRow | null>;
  create(input: CreateCustomFieldInput): Promise<CustomFieldDefinitionRow>;
  update(id: string, patch: UpdateCustomFieldInput): Promise<CustomFieldDefinitionRow>;
  remove(id: string): Promise<void>;
}

export function createCustomFieldStore(client: SupabaseClient, tenantId: string): CustomFieldStore {
  const table = () => client.from("custom_field_definitions") as any;

  return {
    async list(entity) {
      let query = table()
        .select("*")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true })
        .order("key", { ascending: true });
      if (entity) {
        query = query.eq("entity", entity);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data as CustomFieldDefinitionRow[]) ?? [];
    },

    async get(id) {
      const { data, error } = await table().select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data as CustomFieldDefinitionRow | null) ?? null;
    },

    async create(input) {
      const { data, error } = await table()
        .insert({
          ...input,
          tenant_id: tenantId,
          options: input.options ?? [],
          required: input.required ?? false,
          position: input.position ?? 0,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as CustomFieldDefinitionRow;
    },

    async update(id, patch) {
      const { data, error } = await table().update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").single();
      if (error) throw error;
      return data as CustomFieldDefinitionRow;
    },

    async remove(id) {
      const { error } = await table().delete().eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;
    },
  };
}
