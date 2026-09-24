import { z } from "zod";

/**
 * Zod schemas for the `tasks` table.
 *
 * Ground truth: `packages/schema-crm/migrations/20251208000000_create_crm_tables.sql`
 * (lines 92-114). No later migration alters this table.
 *
 * Drift note: `apps/app/app/actions/crm/tasks.ts`'s local `Task` type declares
 * `priority` as a required non-null union; the DDL has no `NOT NULL` on
 * `priority` (only a `DEFAULT 'medium'`), so the row schema models it
 * nullable, matching the SQL.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/** `tasks.status` CHECK (20251208000000); NOT NULL, DEFAULT 'todo'. */
export const taskStatusSchema = z.enum(["todo", "in_progress", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** `tasks.priority` CHECK (20251208000000); nullable, DEFAULT 'medium'. */
export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/**
 * `tasks` row — 15 columns. `CONSTRAINT tasks_has_reference` (DB-level, not
 * represented here) requires exactly one of `contact_id`/`company_id`/
 * `deal_id` to be set.
 */
export const taskRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    contact_id: uuid.nullable(),
    company_id: uuid.nullable(),
    deal_id: uuid.nullable(),
    title: z.string(),
    description: z.string().nullable(),
    status: taskStatusSchema,
    priority: taskPrioritySchema.nullable(),
    due_date: timestamptz.nullable(),
    reminder_date: timestamptz.nullable(),
    completed_at: timestamptz.nullable(),
    created_by: uuid.nullable(),
    assigned_to: uuid.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

/** Columns a caller must supply to INSERT a task (rest have DB defaults / are nullable). */
export const taskInsertSchema = taskRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    title: z.string(),
  })
  .strict();

/** Partial patch for UPDATE (`updated_at` is owned by the DB trigger — never send it). */
export const taskUpdateSchema = taskRowSchema.partial();

export type TaskRow = z.infer<typeof taskRowSchema>;
export type TaskInsert = z.infer<typeof taskInsertSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
