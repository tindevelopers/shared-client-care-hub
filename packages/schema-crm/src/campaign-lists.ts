import { z } from "zod";

/**
 * Zod schemas for the `campaign_lists` table.
 *
 * Ground truth: `packages/schema-crm/migrations/20260210000000_create_campaign_tables.sql`
 * (lines 35-51). No later migration alters this table.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/** `campaign_lists.source_type` CHECK (20260210000000); NOT NULL, no default. */
export const campaignListSourceTypeSchema = z.enum([
  "csv",
  "excel",
  "google_sheets",
  "airtable",
  "gohighlevel",
  "hubspot",
  "salesforce",
  "pipedrive",
]);
export type CampaignListSourceType = z.infer<typeof campaignListSourceTypeSchema>;

/** `campaign_lists.status` CHECK (20260210000000); nullable, DEFAULT 'pending'. */
export const campaignListStatusSchema = z.enum(["pending", "importing", "completed", "failed"]);
export type CampaignListStatus = z.infer<typeof campaignListStatusSchema>;

/** `campaign_lists` row — 11 columns. No `updated_at` column/trigger on this table. */
export const campaignListRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    campaign_id: uuid,
    name: z.string(),
    source_type: campaignListSourceTypeSchema,
    source_config: jsonb.nullable(),
    field_mapping: jsonb.nullable(),
    total_records: z.number().int().nullable(),
    imported_records: z.number().int().nullable(),
    status: campaignListStatusSchema.nullable(),
    last_synced_at: timestamptz.nullable(),
    created_at: timestamptz,
  })
  .strict();

/** Columns a caller must supply to INSERT a campaign list (rest have DB defaults / are nullable). */
export const campaignListInsertSchema = campaignListRowSchema
  .omit({ id: true, created_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    campaign_id: uuid,
    name: z.string(),
    source_type: campaignListSourceTypeSchema,
  })
  .strict();

export const campaignListUpdateSchema = campaignListRowSchema.partial();

export type CampaignListRow = z.infer<typeof campaignListRowSchema>;
export type CampaignListInsert = z.infer<typeof campaignListInsertSchema>;
export type CampaignListUpdate = z.infer<typeof campaignListUpdateSchema>;
