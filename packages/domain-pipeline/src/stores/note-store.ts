import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyRow, ContactRow, DealRow, NoteInsert, NoteRow, NoteUpdate } from "@tindevelopers/schema-crm";
import { createActivityStore } from "./activity-store.js";
import { assertBelongsToTenant } from "./tenant-guard.js";

/**
 * Tenant-tier note store, ported from `apps/app/app/actions/crm/notes.ts`.
 *
 * `notes_has_reference` (schema-crm's `20251208000000_create_crm_tables.sql`)
 * requires AT LEAST ONE of `contact_id`/`company_id`/`deal_id` — not
 * enforced in schema-crm's Zod schemas (phase-4a note). `create()` enforces
 * it here, before insert, with a clear error. Each host-supplied reference
 * is also verified to belong to this tenant before insert.
 *
 * `update()`/`remove()` carry no activity-log side effect (Konnect's
 * `updateNote`/`deleteNote` don't call the logging helpers either); only
 * `create()` logs, via `logNoteAdded`, on the first parent present
 * (contact, then company, then deal — same precedence as Konnect's
 * if/else-if chain).
 */

export interface NoteWithRelations extends NoteRow {
  contact?: ContactRow | null;
  company?: CompanyRow | null;
  deal?: DealRow | null;
}

const NOTE_SELECT = `
  *,
  contact:contacts(*),
  company:companies(*),
  deal:deals(*)
`;

export type CreateNoteInput = Omit<NoteInsert, "tenant_id">;
export type UpdateNoteInput = Omit<NoteUpdate, "id" | "tenant_id" | "created_at" | "created_by">;

export interface NoteFilters {
  contact_id?: string;
  company_id?: string;
  deal_id?: string;
}

export interface NoteStore {
  list(filters?: NoteFilters): Promise<NoteWithRelations[]>;
  create(input: CreateNoteInput): Promise<NoteWithRelations>;
  update(id: string, patch: UpdateNoteInput): Promise<NoteWithRelations>;
  remove(id: string): Promise<void>;
}

/** `notes_has_reference`: at least one of contact_id/company_id/deal_id. */
function assertAtLeastOneReference(refs: { contact_id?: string | null; company_id?: string | null; deal_id?: string | null }) {
  const hasReference = !!refs.contact_id || !!refs.company_id || !!refs.deal_id;
  if (!hasReference) {
    throw new Error("Note must reference at least one of contact_id, company_id, or deal_id");
  }
}

export function createNoteStore(client: SupabaseClient, tenantId: string): NoteStore {
  const table = () => client.from("notes") as any;
  const activities = createActivityStore(client, tenantId);

  return {
    async list(filters = {}) {
      let q = table().select(NOTE_SELECT).eq("tenant_id", tenantId);
      if (filters.contact_id) q = q.eq("contact_id", filters.contact_id);
      if (filters.company_id) q = q.eq("company_id", filters.company_id);
      if (filters.deal_id) q = q.eq("deal_id", filters.deal_id);

      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      return (data as NoteWithRelations[]) ?? [];
    },

    async create(input) {
      assertAtLeastOneReference(input);
      if (input.contact_id) await assertBelongsToTenant(client, "contacts", input.contact_id, tenantId, "Contact");
      if (input.company_id) await assertBelongsToTenant(client, "companies", input.company_id, tenantId, "Company");
      if (input.deal_id) await assertBelongsToTenant(client, "deals", input.deal_id, tenantId, "Deal");

      const { data, error } = await table()
        .insert({
          ...input,
          tenant_id: tenantId,
          contact_id: input.contact_id || null,
          company_id: input.company_id || null,
          deal_id: input.deal_id || null,
          title: input.title || null,
          type: input.type || null,
          metadata: input.metadata ?? null,
          created_by: input.created_by || null,
        })
        .select(NOTE_SELECT)
        .single();
      if (error) throw error;

      const row = data as NoteWithRelations;
      if (input.contact_id) {
        await activities.logNoteAdded(row.id, "contact", input.contact_id);
      } else if (input.company_id) {
        await activities.logNoteAdded(row.id, "company", input.company_id);
      } else if (input.deal_id) {
        await activities.logNoteAdded(row.id, "deal", input.deal_id);
      }
      return row;
    },

    async update(id, patch) {
      const { data, error } = await table().update(patch).eq("id", id).eq("tenant_id", tenantId).select(NOTE_SELECT).single();
      if (error) throw error;
      return data as NoteWithRelations;
    },

    async remove(id) {
      const { error } = await table().delete().eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;
    },
  };
}
