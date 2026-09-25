import { z } from "zod";

/**
 * Zod schemas for the `deal_stages` and `deals` tables.
 *
 * Ground truth: `packages/schema-crm/migrations/20251208000000_create_crm_tables.sql`
 * (deal_stages lines 58-67, deals lines 70-89). No later migration alters
 * either table.
 *
 * Drift note: `apps/app/app/actions/crm/deals.ts` hard-codes six default deal
 * stages in application code (`createDefaultDealStages()`); the DDL puts no
 * defaults or seed data in the migration itself.
 */

const timestamptz = z.string();
/** Postgres `date` (no time component), serialized as "YYYY-MM-DD". */
const date = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/**
 * `deal_stages` row — 7 columns. `UNIQUE(tenant_id, position)`
 * (deal_stages_tenant_position_unique) is a DB-level constraint, not
 * represented here. No `updated_at` column/trigger on this table.
 */
export const dealStageRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    name: z.string(),
    position: z.number().int(),
    color: z.string().nullable(),
    is_closed: z.boolean().nullable(),
    created_at: timestamptz,
  })
  .strict();

export const dealStageInsertSchema = dealStageRowSchema
  .omit({ id: true, created_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    name: z.string(),
  })
  .strict();

export const dealStageUpdateSchema = dealStageRowSchema.partial();

export type DealStageRow = z.infer<typeof dealStageRowSchema>;
export type DealStageInsert = z.infer<typeof dealStageInsertSchema>;
export type DealStageUpdate = z.infer<typeof dealStageUpdateSchema>;

/**
 * `deals` row — 17 columns. `probability` CHECK (0-100) is enforced here;
 * `stage_id` is `NOT NULL REFERENCES deal_stages(id) ON DELETE RESTRICT`
 * (no other CHECK constraints on this table).
 */
export const dealRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    contact_id: uuid.nullable(),
    company_id: uuid.nullable(),
    name: z.string(),
    stage_id: uuid,
    value: z.number(),
    currency: z.string().nullable(),
    probability: z.number().int().min(0).max(100).nullable(),
    expected_close_date: date.nullable(),
    actual_close_date: date.nullable(),
    description: z.string().nullable(),
    tags: z.array(z.string()).nullable(),
    custom_fields: jsonb.nullable(),
    created_by: uuid.nullable(),
    assigned_to: uuid.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

/** Columns a caller must supply to INSERT a deal (rest have DB defaults / are nullable). */
export const dealInsertSchema = dealRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    name: z.string(),
    stage_id: uuid,
  })
  .strict();

/** Partial patch for UPDATE (`updated_at` is owned by the DB trigger — never send it). */
export const dealUpdateSchema = dealRowSchema.partial();

export type DealRow = z.infer<typeof dealRowSchema>;
export type DealInsert = z.infer<typeof dealInsertSchema>;
export type DealUpdate = z.infer<typeof dealUpdateSchema>;
