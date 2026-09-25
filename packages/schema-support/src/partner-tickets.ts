import { z } from "zod";

/**
 * Zod schemas for `partner_support_tickets` and `partner_support_ticket_replies`.
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20260913130000_create_partner_support_tickets.sql
 * (shipped verbatim in this package's `migrations/`).
 *
 * These two tables are a genuinely different actor relationship from the
 * tenant-scoped `support_tickets`/`support_ticket_threads` pair modeled in
 * `tickets.ts`/`threads.ts`: they are keyed by `partner_id` (an agency
 * filing a ticket with the platform), with `tenant_id` only an optional,
 * nullable reference to which of the partner's tenants the ticket concerns.
 * Per the design decision recorded for this shape (client-care domain shape
 * at scale, "actor-scoped support"), they get their own owned pair here
 * rather than being folded into the tenant ticket schema.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/** `partner_support_tickets.priority` CHECK (20260913130000). */
export const partnerSupportTicketPrioritySchema = z.enum(["low", "medium", "high"]);
export type PartnerSupportTicketPriority = z.infer<typeof partnerSupportTicketPrioritySchema>;

/** `partner_support_tickets.status` CHECK (20260913130000). */
export const partnerSupportTicketStatusSchema = z.enum(["open", "in_progress", "resolved"]);
export type PartnerSupportTicketStatus = z.infer<typeof partnerSupportTicketStatusSchema>;

/**
 * `partner_support_tickets` row — 10 columns.
 *
 * `tenant_id` is nullable (`REFERENCES tenants(id) ON DELETE SET NULL`): a
 * partner ticket need not concern any one tenant. `details` is `NOT NULL
 * DEFAULT ''`, so it is required on the row but optional on insert.
 */
export const partnerSupportTicketRowSchema = z
  .object({
    id: uuid,
    partner_id: uuid,
    tenant_id: uuid.nullable(),
    subject: z.string(),
    details: z.string(),
    priority: partnerSupportTicketPrioritySchema,
    status: partnerSupportTicketStatusSchema,
    created_by: uuid,
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

export const partnerSupportTicketInsertSchema = partnerSupportTicketRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    partner_id: uuid,
    subject: z.string(),
    created_by: uuid,
  })
  .strict();

export const partnerSupportTicketUpdateSchema = partnerSupportTicketRowSchema.partial();

export type PartnerSupportTicketRow = z.infer<typeof partnerSupportTicketRowSchema>;
export type PartnerSupportTicketInsert = z.infer<typeof partnerSupportTicketInsertSchema>;
export type PartnerSupportTicketUpdate = z.infer<typeof partnerSupportTicketUpdateSchema>;

/**
 * `partner_support_ticket_replies` row — 5 columns, no `updated_at`
 * (replies are append-only).
 */
export const partnerSupportTicketReplyRowSchema = z
  .object({
    id: uuid,
    ticket_id: uuid,
    author_user_id: uuid,
    body: z.string(),
    created_at: timestamptz,
  })
  .strict();

export const partnerSupportTicketReplyInsertSchema = partnerSupportTicketReplyRowSchema
  .omit({ id: true, created_at: true })
  .strict();

export const partnerSupportTicketReplyUpdateSchema = partnerSupportTicketReplyRowSchema.partial();

export type PartnerSupportTicketReplyRow = z.infer<typeof partnerSupportTicketReplyRowSchema>;
export type PartnerSupportTicketReplyInsert = z.infer<typeof partnerSupportTicketReplyInsertSchema>;
export type PartnerSupportTicketReplyUpdate = z.infer<typeof partnerSupportTicketReplyUpdateSchema>;
