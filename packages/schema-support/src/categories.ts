import { z } from "zod";

/**
 * Zod schema for the `support_categories` table.
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20251221000000_create_support_tickets_schema.sql
 * (lines 9-18), composed with the TypeScript types at
 * shell-base-admin packages/core-kernel/support/types.ts.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/**
 * `support_categories` row — 7 columns.
 *
 * Drift note: the DDL declares `is_active BOOLEAN DEFAULT TRUE` with no
 * `NOT NULL` (unlike every other boolean/timestamp column in this migration,
 * which is explicit `NOT NULL`). `core-kernel/support/types.ts` types
 * `is_active` as non-null `boolean` — the SQL wins, so the row schema keeps
 * it nullable.
 */
export const supportCategoryRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    name: z.string(),
    description: z.string().nullable(),
    is_active: z.boolean().nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

export const supportCategoryInsertSchema = supportCategoryRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    name: z.string(),
  })
  .strict();

export const supportCategoryUpdateSchema = supportCategoryRowSchema.partial();

export type SupportCategoryRow = z.infer<typeof supportCategoryRowSchema>;
export type SupportCategoryInsert = z.infer<typeof supportCategoryInsertSchema>;
export type SupportCategoryUpdate = z.infer<typeof supportCategoryUpdateSchema>;
