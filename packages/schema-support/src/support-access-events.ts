import { z } from "zod";

/**
 * Zod schema for the `support_access_events` table — the append-only audit
 * log of reads made through an active `support_access_grants` row.
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20260924120000_support_access_grants.sql (section 1).
 * No UPDATE/DELETE RLS policy exists (see
 * `support_access_events_no_update`/`..._no_delete` triggers in that
 * migration) — rows are written only by the grant-reading SECURITY DEFINER
 * functions in the same migration.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/** `support_access_events.action` CHECK. */
export const supportAccessEventActionSchema = z.enum(["list_tickets", "view_ticket", "download_attachment"]);
export type SupportAccessEventAction = z.infer<typeof supportAccessEventActionSchema>;

/**
 * `support_access_events` row — 6 columns.
 *
 * `ticket_id`/`attachment_id` are plain `uuid` columns, not foreign keys:
 * the log keeps its record of what was read even after the ticket or
 * attachment is deleted.
 */
export const supportAccessEventRowSchema = z
  .object({
    id: uuid,
    grant_id: uuid,
    actor_id: uuid.nullable(),
    action: supportAccessEventActionSchema,
    ticket_id: uuid.nullable(),
    attachment_id: uuid.nullable(),
    created_at: timestamptz,
  })
  .strict();

export const supportAccessEventInsertSchema = supportAccessEventRowSchema
  .omit({ id: true, created_at: true })
  .partial()
  .extend({
    grant_id: uuid,
    action: supportAccessEventActionSchema,
  })
  .strict();

export const supportAccessEventUpdateSchema = supportAccessEventRowSchema.partial();

export type SupportAccessEventRow = z.infer<typeof supportAccessEventRowSchema>;
export type SupportAccessEventInsert = z.infer<typeof supportAccessEventInsertSchema>;
export type SupportAccessEventUpdate = z.infer<typeof supportAccessEventUpdateSchema>;
