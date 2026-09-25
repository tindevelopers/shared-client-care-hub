import { z } from "zod";

/**
 * Zod schemas for the `notes` table.
 *
 * Ground truth: `packages/schema-crm/migrations/20251208000000_create_crm_tables.sql`
 * (lines 117-135). No later migration alters this table.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/** `notes.type` CHECK (20251208000000); nullable, DEFAULT 'note'. */
export const noteTypeSchema = z.enum(["note", "email", "call", "meeting", "other"]);
export type NoteType = z.infer<typeof noteTypeSchema>;

/**
 * `notes` row — 12 columns. `CONSTRAINT notes_has_reference` (DB-level, not
 * represented here) requires at least one of `contact_id`/`company_id`/
 * `deal_id` to be set.
 */
export const noteRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    contact_id: uuid.nullable(),
    company_id: uuid.nullable(),
    deal_id: uuid.nullable(),
    title: z.string().nullable(),
    content: z.string(),
    type: noteTypeSchema.nullable(),
    metadata: jsonb.nullable(),
    created_by: uuid.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

/** Columns a caller must supply to INSERT a note (rest have DB defaults / are nullable). */
export const noteInsertSchema = noteRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    content: z.string(),
  })
  .strict();

/** Partial patch for UPDATE (`updated_at` is owned by the DB trigger — never send it). */
export const noteUpdateSchema = noteRowSchema.partial();

export type NoteRow = z.infer<typeof noteRowSchema>;
export type NoteInsert = z.infer<typeof noteInsertSchema>;
export type NoteUpdate = z.infer<typeof noteUpdateSchema>;
