import { z } from "zod";

/**
 * Zod schemas for the `campaign_events` table.
 *
 * Ground truth: `packages/schema-crm/migrations/20260210000000_create_campaign_tables.sql`
 * (lines 85-94). No later migration alters this table.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/**
 * `campaign_events` row — 7 columns; an append-only audit trail. `event_type`
 * and `channel` are plain `TEXT` with no CHECK constraint (unlike most other
 * enum-shaped columns in this package).
 */
export const campaignEventRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    campaign_id: uuid,
    recipient_id: uuid.nullable(),
    event_type: z.string(),
    channel: z.string().nullable(),
    payload: jsonb.nullable(),
    created_at: timestamptz,
  })
  .strict();

/** Columns a caller must supply to INSERT a campaign event (rest have DB defaults / are nullable). */
export const campaignEventInsertSchema = campaignEventRowSchema
  .omit({ id: true, created_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    campaign_id: uuid,
    event_type: z.string(),
  })
  .strict();

/** Partial patch for UPDATE (events are effectively append-only; provided for symmetry). */
export const campaignEventUpdateSchema = campaignEventRowSchema.partial();

export type CampaignEventRow = z.infer<typeof campaignEventRowSchema>;
export type CampaignEventInsert = z.infer<typeof campaignEventInsertSchema>;
export type CampaignEventUpdate = z.infer<typeof campaignEventUpdateSchema>;
