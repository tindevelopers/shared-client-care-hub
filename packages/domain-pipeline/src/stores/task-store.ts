import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyRow, ContactRow, DealRow, TaskInsert, TaskRow, TaskUpdate } from "@tindevelopers/schema-crm";
import { createActivityStore } from "./activity-store.js";
import { assertBelongsToTenant } from "./tenant-guard.js";

/**
 * Tenant-tier task store, ported from `apps/app/app/actions/crm/tasks.ts`.
 *
 * `tasks_has_reference` (schema-crm's `20251208000000_create_crm_tables.sql`)
 * requires exactly one of `contact_id`/`company_id`/`deal_id` — not enforced
 * in schema-crm's Zod schemas (phase-4a note). `create()` enforces it here,
 * before insert, with a clear error instead of the DB CHECK's raw
 * constraint-violation message. Each host-supplied reference is also
 * verified to belong to this tenant before insert.
 *
 * `update()` relies on the DB CHECK for the same invariant (a patch is
 * partial by nature; only a full picture of the current row plus the patch
 * proves the invariant, which the CHECK already computes for free) but still
 * verifies any reference id it changes.
 */

export interface TaskWithRelations extends TaskRow {
  contact?: ContactRow | null;
  company?: CompanyRow | null;
  deal?: DealRow | null;
}

const TASK_SELECT = `
  *,
  contact:contacts(*),
  company:companies(*),
  deal:deals(*)
`;

export type CreateTaskInput = Omit<TaskInsert, "tenant_id">;
export type UpdateTaskInput = Omit<TaskUpdate, "id" | "tenant_id" | "created_at" | "created_by">;

export interface TaskFilters {
  status?: TaskRow["status"];
  assigned_to?: string;
  due_date?: string;
}

export interface TaskStore {
  list(filters?: TaskFilters): Promise<TaskWithRelations[]>;
  get(id: string): Promise<TaskWithRelations | null>;
  create(input: CreateTaskInput): Promise<TaskWithRelations>;
  update(id: string, patch: UpdateTaskInput): Promise<TaskWithRelations>;
  remove(id: string): Promise<void>;
  bulkRemove(ids: string[]): Promise<{ deleted: number }>;
  bulkComplete(ids: string[]): Promise<{ updated: number }>;
}

/** `tasks_has_reference`: exactly one of contact_id/company_id/deal_id. */
function assertExactlyOneReference(refs: { contact_id?: string | null; company_id?: string | null; deal_id?: string | null }) {
  const count = [refs.contact_id, refs.company_id, refs.deal_id].filter((id) => !!id).length;
  if (count !== 1) {
    throw new Error("Task must reference exactly one of contact_id, company_id, or deal_id");
  }
}

export function createTaskStore(client: SupabaseClient, tenantId: string): TaskStore {
  const table = () => client.from("tasks") as any;
  const activities = createActivityStore(client, tenantId);

  async function verifyReferences(refs: { contact_id?: string | null; company_id?: string | null; deal_id?: string | null }) {
    if (refs.contact_id) await assertBelongsToTenant(client, "contacts", refs.contact_id, tenantId, "Contact");
    if (refs.company_id) await assertBelongsToTenant(client, "companies", refs.company_id, tenantId, "Company");
    if (refs.deal_id) await assertBelongsToTenant(client, "deals", refs.deal_id, tenantId, "Deal");
  }

  return {
    async list(filters = {}) {
      let q = table().select(TASK_SELECT).eq("tenant_id", tenantId);
      if (filters.status) q = q.eq("status", filters.status);
      if (filters.assigned_to) q = q.eq("assigned_to", filters.assigned_to);
      if (filters.due_date) q = q.lte("due_date", filters.due_date);

      const { data, error } = await q.order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data as TaskWithRelations[]) ?? [];
    },

    async get(id) {
      const { data, error } = await table().select(TASK_SELECT).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data as TaskWithRelations | null) ?? null;
    },

    async create(input) {
      assertExactlyOneReference(input);
      await verifyReferences(input);

      const { data, error } = await table()
        .insert({
          ...input,
          tenant_id: tenantId,
          contact_id: input.contact_id || null,
          company_id: input.company_id || null,
          deal_id: input.deal_id || null,
          description: input.description || null,
          priority: input.priority || null,
          due_date: input.due_date || null,
          reminder_date: input.reminder_date || null,
          created_by: input.created_by || null,
          assigned_to: input.assigned_to || null,
        })
        .select(TASK_SELECT)
        .single();
      if (error) throw error;

      const row = data as TaskWithRelations;
      await activities.logEntityCreated("task", row.id, row.title);
      return row;
    },

    async update(id, patch) {
      await verifyReferences(patch);

      const updates: UpdateTaskInput = { ...patch };
      if (updates.status === "done" && !updates.completed_at) {
        updates.completed_at = new Date().toISOString();
      }

      const { data, error } = await table().update(updates).eq("id", id).eq("tenant_id", tenantId).select(TASK_SELECT).single();
      if (error) throw error;
      return data as TaskWithRelations;
    },

    async remove(id) {
      const { data: existing } = await table().select("title").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

      const { error } = await table().delete().eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;

      if (existing) {
        await activities.logEntityDeleted("task", id, (existing as { title: string }).title);
      }
    },

    async bulkRemove(ids) {
      const { data, error, count } = await table().delete().in("id", ids).eq("tenant_id", tenantId).select("id");
      if (error) throw error;
      return { deleted: Array.isArray(data) ? data.length : (count ?? 0) };
    },

    async bulkComplete(ids) {
      const { data, error } = await table()
        .update({ status: "done", completed_at: new Date().toISOString() })
        .in("id", ids)
        .eq("tenant_id", tenantId)
        .select("id");
      if (error) throw error;
      return { updated: Array.isArray(data) ? data.length : 0 };
    },
  };
}
