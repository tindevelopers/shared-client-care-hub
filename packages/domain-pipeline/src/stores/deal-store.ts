import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyRow, ContactRow, DealInsert, DealRow, DealStageRow, DealUpdate } from "@tindevelopers/schema-crm";
import { createActivityStore } from "./activity-store.js";
import { assertBelongsToTenant } from "./tenant-guard.js";

/**
 * Tenant-tier deal store, ported from `apps/app/app/actions/crm/deals.ts`.
 *
 * `updateDeal()` in Konnect uses `getCurrentTenant()` while every other
 * function there uses `getTenantForCrm()` — an inconsistency that
 * disappears here: every method takes `tenantId` once, at store
 * construction, and scopes every query to it.
 *
 * `company_id`, `contact_id`, and `stage_id` are host-supplied foreign keys
 * into tables this package doesn't own the writes of (or, for `stage_id`,
 * a sibling table it does) — a foreign key only proves the row exists
 * somewhere, so `create`/`update` verify each one belongs to this tenant
 * before writing (new vs. Konnect, which trusted the id as-is).
 */

export interface DealWithRelations extends DealRow {
  contact?: ContactRow | null;
  company?: CompanyRow | null;
  stage?: DealStageRow | null;
}

const DEAL_SELECT = `
  *,
  contact:contacts(*),
  company:companies(*),
  stage:deal_stages(*)
`;

export type CreateDealInput = Omit<DealInsert, "tenant_id">;
export type UpdateDealInput = Omit<DealUpdate, "id" | "tenant_id" | "created_at" | "created_by">;

export interface DealStore {
  list(): Promise<DealWithRelations[]>;
  listByStage(): Promise<Record<string, DealWithRelations[]>>;
  get(id: string): Promise<DealWithRelations | null>;
  create(input: CreateDealInput): Promise<DealWithRelations>;
  update(id: string, patch: UpdateDealInput): Promise<DealWithRelations>;
  remove(id: string): Promise<void>;
}

export function createDealStore(client: SupabaseClient, tenantId: string): DealStore {
  const table = () => client.from("deals") as any;
  const activities = createActivityStore(client, tenantId);

  async function verifyReferences(refs: { company_id?: string | null; contact_id?: string | null; stage_id?: string }) {
    if (refs.company_id) await assertBelongsToTenant(client, "companies", refs.company_id, tenantId, "Company");
    if (refs.contact_id) await assertBelongsToTenant(client, "contacts", refs.contact_id, tenantId, "Contact");
    if (refs.stage_id) await assertBelongsToTenant(client, "deal_stages", refs.stage_id, tenantId, "Deal stage");
  }

  async function list(): Promise<DealWithRelations[]> {
    const { data, error } = await table()
      .select(DEAL_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as DealWithRelations[]) ?? [];
  }

  return {
    list,

    async listByStage() {
      const deals = await list();
      const grouped: Record<string, DealWithRelations[]> = {};
      for (const deal of deals) {
        (grouped[deal.stage_id] ??= []).push(deal);
      }
      return grouped;
    },

    async get(id) {
      const { data, error } = await table().select(DEAL_SELECT).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data as DealWithRelations | null) ?? null;
    },

    async create(input) {
      await verifyReferences(input);

      const { data, error } = await table()
        .insert({
          ...input,
          tenant_id: tenantId,
          contact_id: input.contact_id || null,
          company_id: input.company_id || null,
          currency: input.currency || null,
          probability: input.probability ?? null,
          expected_close_date: input.expected_close_date || null,
          actual_close_date: input.actual_close_date || null,
          description: input.description || null,
          tags: input.tags ?? null,
          custom_fields: input.custom_fields ?? null,
          created_by: input.created_by || null,
          assigned_to: input.assigned_to || null,
        })
        .select(DEAL_SELECT)
        .single();
      if (error) throw error;

      const row = data as DealWithRelations;
      await activities.logEntityCreated("deal", row.id, row.name);
      return row;
    },

    async update(id, patch) {
      await verifyReferences(patch);

      const { data, error } = await table().update(patch).eq("id", id).eq("tenant_id", tenantId).select(DEAL_SELECT).single();
      if (error) throw error;

      const row = data as DealWithRelations;
      await activities.logEntityUpdated("deal", id, row.name, patch);
      return row;
    },

    async remove(id) {
      const { data: existing } = await table().select("name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

      const { error } = await table().delete().eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;

      if (existing) {
        await activities.logEntityDeleted("deal", id, (existing as { name: string }).name);
      }
    },
  };
}
