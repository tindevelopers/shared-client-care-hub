import { z } from "zod";
import { supportOwnerScopeSchema } from "./tickets.js";

/**
 * Zod schema for the `support_categories` table.
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20251221000000_create_support_tickets_schema.sql
 * (lines 9-18), composed with the TypeScript types at
 * shell-base-admin packages/core-kernel/support/types.ts.
 *
 * 20260924100000_support_owner_escalation.sql: `tenant_id` DROP NOT NULL,
 * `+ partner_id`, `+ owner_scope` ('tenant' | 'partner' | 'platform',
 * default 'tenant') — same owner columns as `support_tickets`.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/**
 * `support_categories` row — 9 columns.
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
    tenant_id: uuid.nullable(),
    partner_id: uuid.nullable(),
    owner_scope: supportOwnerScopeSchema,
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
    name: z.string(),
  })
  .strict();

export const supportCategoryUpdateSchema = supportCategoryRowSchema.partial();

export type SupportCategoryRow = z.infer<typeof supportCategoryRowSchema>;
export type SupportCategoryInsert = z.infer<typeof supportCategoryInsertSchema>;
export type SupportCategoryUpdate = z.infer<typeof supportCategoryUpdateSchema>;
