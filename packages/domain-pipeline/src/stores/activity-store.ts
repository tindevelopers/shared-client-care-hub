import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityInsert, ActivityRow, ActivityType } from "@tindevelopers/schema-crm";

/**
 * Tenant-tier activity store, ported from
 * `apps/app/app/actions/crm/activities.ts`. Activities are effectively
 * append-only audit-trail rows (no `has_reference` CHECK, no UPDATE/DELETE
 * RLS policy — see schema-crm's ground truth) written internally by
 * company/deal/task/note stores after their own writes, whose ids are
 * already tenant-verified by that point; this store therefore only
 * tenant-scopes its own queries and does not re-verify the
 * contact_id/company_id/deal_id/task_id/note_id it is handed (unlike
 * deal-store/task-store/note-store, which DO verify host-supplied
 * references into tables they don't own).
 *
 * `logEntityCreated`/`logEntityUpdated`/`logEntityDeleted`/`logNoteAdded`
 * swallow their own errors (matching Konnect's activities.ts verbatim):
 * activity logging must never fail the caller's main write.
 */

export type PipelineEntityType = "company" | "deal" | "task";

export interface ActivityFilters {
  contact_id?: string;
  company_id?: string;
  deal_id?: string;
  task_id?: string;
}

export interface ActivityStore {
  list(filters?: ActivityFilters): Promise<ActivityRow[]>;
  create(input: ActivityCreateInput): Promise<ActivityRow>;
  logEntityCreated(
    type: PipelineEntityType,
    entityId: string,
    entityName: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  logEntityUpdated(
    type: PipelineEntityType,
    entityId: string,
    entityName: string,
    changes?: Record<string, unknown>,
  ): Promise<void>;
  logEntityDeleted(type: PipelineEntityType, entityId: string, entityName: string): Promise<void>;
  logNoteAdded(noteId: string, entityType: "contact" | "company" | "deal", entityId: string): Promise<void>;
}

export type ActivityCreateInput = Omit<ActivityInsert, "tenant_id">;

function entityIdField(type: PipelineEntityType): "company_id" | "deal_id" | "task_id" {
  return type === "company" ? "company_id" : type === "deal" ? "deal_id" : "task_id";
}

export function createActivityStore(client: SupabaseClient, tenantId: string): ActivityStore {
  const table = () => client.from("activities") as any;

  async function create(input: ActivityCreateInput): Promise<ActivityRow> {
    const { data, error } = await table()
      .insert({
        ...input,
        tenant_id: tenantId,
        contact_id: input.contact_id || null,
        company_id: input.company_id || null,
        deal_id: input.deal_id || null,
        task_id: input.task_id || null,
        note_id: input.note_id || null,
        metadata: input.metadata ?? {},
        created_by: input.created_by || null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as ActivityRow;
  }

  async function logActivity(type: ActivityType, description: string, refs: Partial<ActivityInsert>, metadata: Record<string, unknown>) {
    try {
      await create({ type, description, metadata, ...refs } as ActivityCreateInput);
    } catch (error) {
      console.error(`Error logging ${type} activity:`, error);
    }
  }

  return {
    async list(filters = {}) {
      let q = table().select("*").eq("tenant_id", tenantId);
      if (filters.contact_id) q = q.eq("contact_id", filters.contact_id);
      if (filters.company_id) q = q.eq("company_id", filters.company_id);
      if (filters.deal_id) q = q.eq("deal_id", filters.deal_id);
      if (filters.task_id) q = q.eq("task_id", filters.task_id);

      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      return (data as ActivityRow[]) ?? [];
    },

    create,

    async logEntityCreated(type, entityId, entityName, metadata = {}) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      await logActivity("created", `${label} "${entityName}" was created`, { [entityIdField(type)]: entityId }, metadata);
    },

    async logEntityUpdated(type, entityId, entityName, changes = {}) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      await logActivity("updated", `${label} "${entityName}" was updated`, { [entityIdField(type)]: entityId }, { changes });
    },

    async logEntityDeleted(type, entityId, entityName) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      await logActivity("deleted", `${label} "${entityName}" was deleted`, { [entityIdField(type)]: entityId }, {});
    },

    async logNoteAdded(noteId, entityType, entityId) {
      const refField = entityType === "contact" ? "contact_id" : entityType === "company" ? "company_id" : "deal_id";
      await logActivity("note_added", "A note was added", { note_id: noteId, [refField]: entityId }, {});
    },
  };
}
