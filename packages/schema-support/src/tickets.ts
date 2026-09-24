import { z } from "zod";

/**
 * Zod schema for the `support_tickets` table.
 *
 * Ground truth: konnect-caas-base supabase/migrations, composed with the
 * TypeScript types at shell-base-admin packages/core-kernel/support/types.ts.
 *
 * Base: 20251221000000_create_support_tickets_schema.sql (lines 21-35).
 * Alter shipped in this package's migrations/:
 * 20260223000000_support_tickets_error_escalation.sql (support_code,
 * support_ref, escalated_to_platform_admin_at).
 *
 * Alter NOT shipped here: `external_refs`/`sync_state` (the "R2 envelope on
 * the first support capability") were added by konnect's
 * `20260905000000_create_sync_bindings.sql`, which is owned by the sync
 * engine (creates sync_bindings/sync_runs/sync_conflicts/sync_dead_letters —
 * none of them support tables). Per ADR-0002 that migration is not re-shipped
 * from this package (see README "Migrations"); the two columns are still
 * modeled below because they are real, current DB ground truth.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/** `support_tickets.status` CHECK (20251221000000). */
export const supportTicketStatusSchema = z.enum(["open", "in_progress", "resolved", "closed"]);
export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;

/** `support_tickets.priority` CHECK (20251221000000). */
export const supportTicketPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type SupportTicketPriority = z.infer<typeof supportTicketPrioritySchema>;

/**
 * `support_tickets` row — 17 effective columns.
 *
 * `ticket_number` is `NOT NULL` in the DDL but is populated by the
 * `set_support_ticket_number` BEFORE INSERT trigger when omitted or empty —
 * the strict insert schema omits it entirely, like `id`/`created_at`.
 *
 * Drift note: `core-kernel/support/types.ts` does not model `external_refs`
 * or `sync_state` (added by 20260905000000, after the types file was last
 * touched) — the SQL wins, so both are modeled here with the DDL's `NOT
 * NULL` type. They are `.optional()` on the row schema and omitted from the
 * insert schema because the migration that creates them is not shipped by
 * this package (see the module doc comment above) — a row read against
 * only this package's migrations won't have them.
 */
export const supportTicketRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    ticket_number: z.string(),
    subject: z.string(),
    description: z.string().nullable(),
    status: supportTicketStatusSchema,
    priority: supportTicketPrioritySchema,
    category_id: uuid.nullable(),
    created_by: uuid,
    assigned_to: uuid.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
    support_code: z.string().nullable(),
    support_ref: z.string().nullable(),
    escalated_to_platform_admin_at: timestamptz.nullable(),
    external_refs: jsonb.optional(),
    sync_state: jsonb.optional(),
  })
  .strict();

export const supportTicketInsertSchema = supportTicketRowSchema
  .omit({ id: true, ticket_number: true, created_at: true, updated_at: true, external_refs: true, sync_state: true })
  .partial()
  .extend({
    tenant_id: uuid,
    subject: z.string(),
    created_by: uuid,
  })
  .strict();

export const supportTicketUpdateSchema = supportTicketRowSchema.partial();

export type SupportTicketRow = z.infer<typeof supportTicketRowSchema>;
export type SupportTicketInsert = z.infer<typeof supportTicketInsertSchema>;
export type SupportTicketUpdate = z.infer<typeof supportTicketUpdateSchema>;
