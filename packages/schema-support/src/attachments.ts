import { z } from "zod";

/**
 * Zod schema for the `support_ticket_attachments` table.
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20251221000000_create_support_tickets_schema.sql
 * (lines 50-61), composed with the TypeScript types at
 * shell-base-admin packages/core-kernel/support/types.ts.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/**
 * `support_ticket_attachments` row — 9 columns; no `updated_at` (attachments
 * are immutable records, per the DDL and `core-kernel/support/types.ts`).
 * `file_size` is Postgres `BIGINT`; modeled as `number` (matches the existing
 * TS type and PostgREST's JSON serialization for this column).
 */
export const supportTicketAttachmentRowSchema = z
  .object({
    id: uuid,
    ticket_id: uuid,
    thread_id: uuid.nullable(),
    tenant_id: uuid,
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
    tenant_id: uuid,
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
