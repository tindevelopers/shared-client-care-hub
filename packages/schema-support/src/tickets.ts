import { z } from "zod";

/**
 * Zod schema for the `support_tickets` table.
 *
 * Ground truth: konnect-caas-base supabase/migrations, composed with the
 * TypeScript types at shell-base-admin packages/core-kernel/support/types.ts.
 *
 * Base: 20251221000000_create_support_tickets_schema.sql (lines 21-35).
 * Alters shipped in this package's migrations/:
 * - 20260223000000_support_tickets_error_escalation.sql (added
 *   support_code, support_ref, escalated_to_platform_admin_at).
 * - 20260924100000_support_owner_escalation.sql (Support Escalation Chain):
 *   `tenant_id` DROP NOT NULL, `+ partner_id`, `+ owner_scope` ('tenant' |
 *   'partner' | 'platform', default 'tenant'), `+ group_id` (FK to the new
 *   support_groups), DROP COLUMN `escalated_to_platform_admin_at`, and the
 *   `status` CHECK widened to add 'waiting_on_customer'/'waiting_on_upstream'.
 * - 20260924110000_support_escalation_gateway.sql writes rows through this
 *   table's columns (no DDL of its own — see manifest.ts).
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

/**
 * `support_tickets.status` CHECK, widened by 20260924100000 to add the two
 * escalation-chain waiting states.
 */
export const supportTicketStatusSchema = z.enum([
  "open",
  "in_progress",
  "waiting_on_customer",
  "waiting_on_upstream",
  "resolved",
  "closed",
]);
export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;

/** `support_tickets.priority` CHECK (20251221000000). */
export const supportTicketPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type SupportTicketPriority = z.infer<typeof supportTicketPrioritySchema>;

/**
 * Owner scope shared by every support table (20260924100000):
 * `support_*_owner_scope_check` on each of tickets/categories/threads/
 * attachments/history/groups is `CHECK (owner_scope IN ('tenant', 'partner',
 * 'platform'))`, paired with an `..._exactly_one_owner` CHECK tying
 * `tenant_id`/`partner_id` to it (not modeled here — a cross-column
 * constraint, not a per-column type).
 */
export const supportOwnerScopeSchema = z.enum(["tenant", "partner", "platform"]);
export type SupportOwnerScope = z.infer<typeof supportOwnerScopeSchema>;

/**
 * `support_tickets` row — 19 effective columns (17 own + 2 sync-engine
 * columns modeled for ground truth, see module doc comment).
 *
 * `ticket_number` is `NOT NULL` in the DDL but is populated by the
 * `set_ticket_number` BEFORE INSERT trigger when omitted or empty — the
 * strict insert schema omits it entirely, like `id`/`created_at`.
 *
 * `tenant_id` lost its `NOT NULL` in 20260924100000 (a partner- or
 * platform-owned ticket has no tenant); `partner_id`/`group_id` are new and
 * nullable. `owner_scope` is `NOT NULL DEFAULT 'tenant'`, so it is required
 * on the row but optional on insert.
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
    tenant_id: uuid.nullable(),
    partner_id: uuid.nullable(),
    owner_scope: supportOwnerScopeSchema,
    ticket_number: z.string(),
    subject: z.string(),
    description: z.string().nullable(),
    status: supportTicketStatusSchema,
    priority: supportTicketPrioritySchema,
    category_id: uuid.nullable(),
    group_id: uuid.nullable(),
    created_by: uuid,
    assigned_to: uuid.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
    support_code: z.string().nullable(),
    support_ref: z.string().nullable(),
    external_refs: jsonb.optional(),
    sync_state: jsonb.optional(),
  })
  .strict();

export const supportTicketInsertSchema = supportTicketRowSchema
  .omit({ id: true, ticket_number: true, created_at: true, updated_at: true, external_refs: true, sync_state: true })
  .partial()
  .extend({
    subject: z.string(),
    created_by: uuid,
  })
  .strict();

export const supportTicketUpdateSchema = supportTicketRowSchema.partial();

export type SupportTicketRow = z.infer<typeof supportTicketRowSchema>;
export type SupportTicketInsert = z.infer<typeof supportTicketInsertSchema>;
export type SupportTicketUpdate = z.infer<typeof supportTicketUpdateSchema>;
