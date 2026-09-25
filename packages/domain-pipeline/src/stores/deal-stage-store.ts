import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealStageInsert, DealStageRow, DealStageUpdate } from "@tindevelopers/schema-crm";

/**
 * Tenant-tier deal stage store. Konnect hard-codes six default stages in
 * application code with no per-tenant override
 * (`apps/app/app/actions/crm/deals.ts` `createDefaultDealStages()`); this
 * store instead offers full CRUD so a tenant CAN customize its stages, plus
 * `seedDefaults()` — a separate helper that seeds the same six names/colors
 * only for a tenant that has none yet (a one-time bootstrap, not the only
 * option going forward). `UNIQUE(tenant_id, position)` is a DB-level
 * constraint; a caller inserting/updating into an occupied position gets
 * that constraint's error verbatim.
 */

/** Same six stages, in the same order, Konnect's `createDefaultDealStages()` hard-codes. */
export const DEFAULT_DEAL_STAGES: ReadonlyArray<
  Pick<DealStageInsert, "name" | "position" | "color" | "is_closed">
> = [
  { name: "Lead", position: 0, color: "#94a3b8", is_closed: false },
  { name: "Qualified", position: 1, color: "#60a5fa", is_closed: false },
  { name: "Proposal", position: 2, color: "#a78bfa", is_closed: false },
  { name: "Negotiation", position: 3, color: "#f59e0b", is_closed: false },
  { name: "Won", position: 4, color: "#10b981", is_closed: true },
  { name: "Lost", position: 5, color: "#ef4444", is_closed: true },
];

export type CreateDealStageInput = Omit<DealStageInsert, "tenant_id">;
export type UpdateDealStageInput = Omit<DealStageUpdate, "id" | "tenant_id" | "created_at">;

export interface DealStageStore {
  list(): Promise<DealStageRow[]>;
  get(id: string): Promise<DealStageRow | null>;
  create(input: CreateDealStageInput): Promise<DealStageRow>;
  update(id: string, patch: UpdateDealStageInput): Promise<DealStageRow>;
  remove(id: string): Promise<void>;
  /** Seeds the six default stages, only when this tenant has none yet. */
  seedDefaults(): Promise<DealStageRow[]>;
}

export function createDealStageStore(client: SupabaseClient, tenantId: string): DealStageStore {
  const table = () => client.from("deal_stages") as any;

  async function list(): Promise<DealStageRow[]> {
    const { data, error } = await table().select("*").eq("tenant_id", tenantId).order("position", { ascending: true });
    if (error) throw error;
    return (data as DealStageRow[]) ?? [];
  }

  return {
    list,

    async get(id) {
      const { data, error } = await table().select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data as DealStageRow | null) ?? null;
    },

    async create(input) {
      const { data, error } = await table()
        .insert({
          ...input,
          tenant_id: tenantId,
          color: input.color || null,
          is_closed: input.is_closed ?? false,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as DealStageRow;
    },

    async update(id, patch) {
      const { data, error } = await table().update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").single();
      if (error) throw error;
      return data as DealStageRow;
    },

    async remove(id) {
      const { error } = await table().delete().eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;
    },

    async seedDefaults() {
      const existing = await list();
      if (existing.length > 0) return existing;

      const { data, error } = await table()
        .insert(DEFAULT_DEAL_STAGES.map((stage) => ({ ...stage, tenant_id: tenantId })))
        .select("*");
      if (error) throw error;
      return (data as DealStageRow[]) ?? [];
    },
  };
}
