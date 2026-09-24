import { z } from "zod";

/**
 * Zod schema for the `support_ticket_threads` table (comments/replies).
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20251221000000_create_support_tickets_schema.sql
 * (lines 38-47), composed with the TypeScript types at
 * shell-base-admin packages/core-kernel/support/types.ts.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/**
 * `support_ticket_threads` row — 8 columns.
 *
 * Drift note: `is_internal BOOLEAN DEFAULT FALSE` has no `NOT NULL` in the
 * DDL (same pattern as `support_categories.is_active`), while
 * `core-kernel/support/types.ts` types it as non-null `boolean` — the SQL
 * wins, so the row schema keeps it nullable.
 */
export const supportTicketThreadRowSchema = z
  .object({
    id: uuid,
    ticket_id: uuid,
    tenant_id: uuid,
    user_id: uuid,
    message: z.string(),
    is_internal: z.boolean().nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

export const supportTicketThreadInsertSchema = supportTicketThreadRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    ticket_id: uuid,
    tenant_id: uuid,
    user_id: uuid,
    message: z.string(),
  })
  .strict();

export const supportTicketThreadUpdateSchema = supportTicketThreadRowSchema.partial();

export type SupportTicketThreadRow = z.infer<typeof supportTicketThreadRowSchema>;
export type SupportTicketThreadInsert = z.infer<typeof supportTicketThreadInsertSchema>;
export type SupportTicketThreadUpdate = z.infer<typeof supportTicketThreadUpdateSchema>;
