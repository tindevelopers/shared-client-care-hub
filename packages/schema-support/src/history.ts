import { z } from "zod";

/**
 * Zod schema for the `support_ticket_history` table (audit log of ticket
 * field changes, written by the `track_ticket_history()` trigger).
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20251221000000_create_support_tickets_schema.sql
 * (lines 64-73), composed with the TypeScript types at
 * shell-base-admin packages/core-kernel/support/types.ts (matches exactly —
 * no drift).
 *
 * Per ADR-0002 (shell-base-admin docs/ADR-0002-schema-ownership.md): this
 * table is created by this package's own base migration, so schema-support
 * owns it — it is not a proposal, just a manifest gap closed here.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/**
 * `support_ticket_history` row — 8 columns; append-only (no UPDATE/DELETE
 * RLS policy exists, only SELECT + trigger-driven INSERT). `field_name` has
 * no CHECK constraint in the DDL — the trigger currently writes `"status"`,
 * `"priority"`, or `"assigned_to"`, but the column itself is free-form TEXT.
 */
export const supportTicketHistoryRowSchema = z
  .object({
    id: uuid,
    ticket_id: uuid,
    tenant_id: uuid,
    changed_by: uuid,
    field_name: z.string(),
    old_value: z.string().nullable(),
    new_value: z.string().nullable(),
    created_at: timestamptz,
  })
  .strict();

export const supportTicketHistoryInsertSchema = supportTicketHistoryRowSchema
  .omit({ id: true, created_at: true })
  .partial()
  .extend({
    ticket_id: uuid,
    tenant_id: uuid,
    changed_by: uuid,
    field_name: z.string(),
  })
  .strict();

export const supportTicketHistoryUpdateSchema = supportTicketHistoryRowSchema.partial();

export type SupportTicketHistoryRow = z.infer<typeof supportTicketHistoryRowSchema>;
export type SupportTicketHistoryInsert = z.infer<typeof supportTicketHistoryInsertSchema>;
export type SupportTicketHistoryUpdate = z.infer<typeof supportTicketHistoryUpdateSchema>;
