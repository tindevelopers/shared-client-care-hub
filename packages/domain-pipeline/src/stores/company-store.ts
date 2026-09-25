import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyInsert, CompanyRow, CompanyUpdate } from "@tindevelopers/schema-crm";
import { createActivityStore } from "./activity-store.js";

/**
 * Tenant-tier company store, ported from
 * `apps/app/app/actions/crm/companies.ts`. Identity is never resolved here
 * (injection-only, R2): `created_by` is an explicit optional argument on
 * `create`, never read from `supabase.auth.getUser()` — the host resolves
 * the actor and injects it, the same pattern `domain-support`'s ticket
 * store uses.
 */

export type CreateCompanyInput = Omit<CompanyInsert, "tenant_id">;
export type UpdateCompanyInput = Omit<CompanyUpdate, "id" | "tenant_id" | "created_at" | "created_by">;

export interface CompanyStore {
  list(): Promise<CompanyRow[]>;
  get(id: string): Promise<CompanyRow | null>;
  create(input: CreateCompanyInput): Promise<CompanyRow>;
  update(id: string, patch: UpdateCompanyInput): Promise<CompanyRow>;
  remove(id: string): Promise<void>;
  bulkRemove(ids: string[]): Promise<{ deleted: number }>;
}

export function createCompanyStore(client: SupabaseClient, tenantId: string): CompanyStore {
  const table = () => client.from("companies") as any;
  const activities = createActivityStore(client, tenantId);

  return {
    async list() {
      const { data, error } = await table()
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as CompanyRow[]) ?? [];
    },

    async get(id) {
      const { data, error } = await table().select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data as CompanyRow | null) ?? null;
    },

    async create(input) {
      const { data, error } = await table()
        .insert({
          ...input,
          tenant_id: tenantId,
          website: input.website || null,
          industry: input.industry || null,
          size: input.size || null,
          annual_revenue: input.annual_revenue ?? null,
          description: input.description || null,
          address: input.address ?? null,
          phone: input.phone || null,
          email: input.email || null,
          logo_url: input.logo_url || null,
          tags: input.tags ?? null,
          custom_fields: input.custom_fields ?? null,
          created_by: input.created_by || null,
        })
        .select("*")
        .single();
      if (error) throw error;

      const row = data as CompanyRow;
      await activities.logEntityCreated("company", row.id, row.name);
      return row;
    },

    async update(id, patch) {
      const { data, error } = await table()
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select("*")
        .single();
      if (error) throw error;

      const row = data as CompanyRow;
      await activities.logEntityUpdated("company", id, row.name, patch);
      return row;
    },

    async remove(id) {
      const { data: existing } = await table().select("name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

      const { error } = await table().delete().eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;

      if (existing) {
        await activities.logEntityDeleted("company", id, (existing as { name: string }).name);
      }
    },

    async bulkRemove(ids) {
      const { data, error, count } = await table().delete().in("id", ids).eq("tenant_id", tenantId).select("id");
      if (error) throw error;
      return { deleted: Array.isArray(data) ? data.length : (count ?? 0) };
    },
  };
}
