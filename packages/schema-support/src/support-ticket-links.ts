import { z } from "zod";

/**
 * Zod schema for the `support_ticket_links` table (cross-organization
 * escalation/merge links between two `support_tickets` rows, or between a
 * ticket and an external desk).
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20260924100000_support_owner_escalation.sql
 * (section 7, "Ticket links"). Written by the SECURITY DEFINER gateway
 * functions in 20260924110000_support_escalation_gateway.sql
 * (`support_escalate`/`support_hand_back`/`support_withdraw`/`support_merge`)
 * — no INSERT/UPDATE/DELETE RLS policy exists; only the service role and
 * those functions write this table.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/** `support_ticket_links.kind` CHECK (20260924100000). */
export const supportTicketLinkKindSchema = z.enum(["escalation", "merge"]);
export type SupportTicketLinkKind = z.infer<typeof supportTicketLinkKindSchema>;

/** `support_ticket_links.state` CHECK (20260924100000). */
export const supportTicketLinkStateSchema = z.enum(["active", "resolved", "returned", "withdrawn"]);
export type SupportTicketLinkState = z.infer<typeof supportTicketLinkStateSchema>;

/**
 * `support_ticket_links` row — 12 columns.
 *
 * `support_ticket_links_target_check` (not modeled here — a cross-column
 * constraint): exactly one of `to_ticket_id` or (`provider` + `external_id`)
 * is set, matching an internal merge/escalation vs. a link to an external
 * desk.
 */
export const supportTicketLinkRowSchema = z
  .object({
    id: uuid,
    kind: supportTicketLinkKindSchema,
    from_ticket_id: uuid,
    to_ticket_id: uuid.nullable(),
    provider: z.string().nullable(),
    external_id: z.string().nullable(),
    state: supportTicketLinkStateSchema,
    shared: jsonb,
    resolution: z.string().nullable(),
    created_by: uuid,
    created_at: timestamptz,
    closed_at: timestamptz.nullable(),
  })
  .strict();

export const supportTicketLinkInsertSchema = supportTicketLinkRowSchema
  .omit({ id: true, created_at: true })
  .partial()
  .extend({
    kind: supportTicketLinkKindSchema,
    from_ticket_id: uuid,
    created_by: uuid,
  })
  .strict();

export const supportTicketLinkUpdateSchema = supportTicketLinkRowSchema.partial();

export type SupportTicketLinkRow = z.infer<typeof supportTicketLinkRowSchema>;
export type SupportTicketLinkInsert = z.infer<typeof supportTicketLinkInsertSchema>;
export type SupportTicketLinkUpdate = z.infer<typeof supportTicketLinkUpdateSchema>;
