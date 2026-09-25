import { z } from "zod";
import { supportOwnerScopeSchema } from "./tickets.js";

/**
 * Zod schema for the `support_ticket_attachments` table.
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20251221000000_create_support_tickets_schema.sql
 * (lines 50-61), composed with the TypeScript types at
 * shell-base-admin packages/core-kernel/support/types.ts.
 *
 * 20260924100000_support_owner_escalation.sql: `tenant_id` DROP NOT NULL,
 * `+ partner_id`, `+ owner_scope` ('tenant' | 'partner' | 'platform',
 * default 'tenant') — same owner columns as `support_tickets`. The
 * `support_ticket_attachments_inherit_owner` BEFORE INSERT trigger
 * overwrites all three from the parent ticket, ignoring client input.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/**
 * `support_ticket_attachments` row — 12 columns; no `updated_at` (attachments
 * are immutable records, per the DDL and `core-kernel/support/types.ts`).
 * `file_size` is Postgres `BIGINT`; modeled as `number` (matches the existing
 * TS type and PostgREST's JSON serialization for this column).
 */
export const supportTicketAttachmentRowSchema = z
  .object({
    id: uuid,
    ticket_id: uuid,
    thread_id: uuid.nullable(),
    tenant_id: uuid.nullable(),
    partner_id: uuid.nullable(),
    owner_scope: supportOwnerScopeSchema,
    file_name: z.string(),
    file_path: z.string(),
    file_size: z.number(),
    mime_type: z.string(),
    uploaded_by: uuid,
    created_at: timestamptz,
  })
  .strict();

export const supportTicketAttachmentInsertSchema = supportTicketAttachmentRowSchema
  .omit({ id: true, created_at: true })
  .partial()
  .extend({
    ticket_id: uuid,
    file_name: z.string(),
    file_path: z.string(),
    file_size: z.number(),
    mime_type: z.string(),
    uploaded_by: uuid,
  })
  .strict();

export const supportTicketAttachmentUpdateSchema = supportTicketAttachmentRowSchema.partial();

export type SupportTicketAttachmentRow = z.infer<typeof supportTicketAttachmentRowSchema>;
export type SupportTicketAttachmentInsert = z.infer<typeof supportTicketAttachmentInsertSchema>;
export type SupportTicketAttachmentUpdate = z.infer<typeof supportTicketAttachmentUpdateSchema>;
