import { z } from "zod";
import { supportOwnerScopeSchema } from "./tickets.js";

/**
 * Zod schema for the `support_groups` table (tiers inside one owner, e.g.
 * "Tier 1"/"Tier 2" queues a ticket can be assigned to via
 * `support_tickets.group_id`).
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20260924100000_support_owner_escalation.sql
 * (section 2, "Support groups"). Row Level Security was added a day later by
 * 20260925130000_support_agent_permission.sql (`ALTER TABLE support_groups
 * ENABLE ROW LEVEL SECURITY` — the table was created with policies but
 * without RLS turned on, so they never applied).
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/**
 * `support_groups` row — 8 columns; no `updated_at` (groups are rarely
 * changed and carry no update trigger).
 */
export const supportGroupRowSchema = z
  .object({
    id: uuid,
    owner_scope: supportOwnerScopeSchema,
    tenant_id: uuid.nullable(),
    partner_id: uuid.nullable(),
    name: z.string(),
    rank: z.number().int(),
    is_active: z.boolean(),
    created_at: timestamptz,
  })
  .strict();

export const supportGroupInsertSchema = supportGroupRowSchema
  .omit({ id: true, created_at: true })
  .partial()
  .extend({
    name: z.string(),
    rank: z.number().int(),
  })
  .strict();

export const supportGroupUpdateSchema = supportGroupRowSchema.partial();

export type SupportGroupRow = z.infer<typeof supportGroupRowSchema>;
export type SupportGroupInsert = z.infer<typeof supportGroupInsertSchema>;
export type SupportGroupUpdate = z.infer<typeof supportGroupUpdateSchema>;
