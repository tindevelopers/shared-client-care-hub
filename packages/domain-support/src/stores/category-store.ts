import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateCategoryInput, SupportCategory } from "../types.js";

/**
 * Tenant-tier support category store, ported from
 * `@tindevelopers/core-kernel/support/categories`. `create`/`update`/`remove`
 * need no identity — categories carry no creator column — so there is no
 * auth seam to remove here; the store is tenant-scoped like the others.
 */

export interface SupportCategoryStore {
  list(): Promise<SupportCategory[]>;
  get(id: string): Promise<SupportCategory | null>;
  create(input: CreateCategoryInput): Promise<SupportCategory>;
  update(id: string, input: Partial<CreateCategoryInput>): Promise<SupportCategory>;
  /** Soft delete: sets `is_active` to false (categories are never hard-deleted). */
  remove(id: string): Promise<void>;
}

export function createSupportCategoryStore(
  client: SupabaseClient,
  tenantId: string,
): SupportCategoryStore {
  const table = () => client.from("support_categories") as any;

  return {
    async list() {
      const { data, error } = await table()
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data as SupportCategory[]) ?? [];
    },

    async get(id) {
      const { data, error } = await table()
        .select("*")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data as SupportCategory;
    },

    async create(input) {
      const { data, error } = await table()
        .insert({
          tenant_id: tenantId,
          name: input.name,
          description: input.description ?? null,
          is_active: input.is_active ?? true,
        })
        .select()
        .single();
      if (error) throw error;
      return data as SupportCategory;
    },

    async update(id, input) {
      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.is_active !== undefined) updateData.is_active = input.is_active;

      const { data, error } = await table()
        .update(updateData)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select()
        .single();
      if (error) throw error;
      return data as SupportCategory;
    },

    async remove(id) {
      const { error } = await table()
        .update({ is_active: false })
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },
  };
}
