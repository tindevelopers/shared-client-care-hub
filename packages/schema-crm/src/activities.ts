import { z } from "zod";

/**
 * Zod schemas for the `activities` table.
 *
 * Ground truth: `packages/schema-crm/migrations/20251208000000_create_crm_tables.sql`
 * (lines 138-151), extended by
 * `20260614230000_brevo_webhooks_activities_suppression.sql` (lines 38-71),
 * which drops and recreates `activities_type_check` to add six webhook event
 * types.
 *
 * Drift note: `apps/app/app/actions/crm/activities.ts`'s local `Activity`
 * type's `type` union only lists the original 10 values; it predates the
 * 20260614230000 extension and is missing the six `email_*` webhook types.
 * The row schema below models the current, extended CHECK constraint (16
 * values), which is what the DB actually accepts.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/** `activities.type` CHECK, as replaced by 20260614230000 (16 values). */
export const activityTypeSchema = z.enum([
  "created",
  "updated",
  "deleted",
  "note_added",
  "task_created",
  "task_completed",
  "deal_stage_changed",
  "email_sent",
  "call_made",
  "meeting_scheduled",
  "email_opened",
  "email_clicked",
  "email_bounced",
  "email_delivered",
  "email_failed",
  "email_unsubscribed",
]);
export type ActivityType = z.infer<typeof activityTypeSchema>;

/**
 * `activities` row — 12 columns. No `updated_at` column/trigger and no
 * cross-column CHECK requiring a parent entity (unlike `tasks`/`notes`).
 */
export const activityRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    contact_id: uuid.nullable(),
    company_id: uuid.nullable(),
    deal_id: uuid.nullable(),
    task_id: uuid.nullable(),
    note_id: uuid.nullable(),
    type: activityTypeSchema,
    description: z.string(),
    metadata: jsonb.nullable(),
    created_by: uuid.nullable(),
    created_at: timestamptz,
  })
  .strict();

/** Columns a caller must supply to INSERT an activity (rest have DB defaults / are nullable). */
export const activityInsertSchema = activityRowSchema
  .omit({ id: true, created_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    type: activityTypeSchema,
    description: z.string(),
  })
  .strict();

/** Partial patch for UPDATE (activities are effectively append-only; provided for symmetry). */
export const activityUpdateSchema = activityRowSchema.partial();

export type ActivityRow = z.infer<typeof activityRowSchema>;
export type ActivityInsert = z.infer<typeof activityInsertSchema>;
export type ActivityUpdate = z.infer<typeof activityUpdateSchema>;
