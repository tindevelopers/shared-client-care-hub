import { z } from "zod";

/**
 * Zod schemas for the `campaigns` and `campaign_recipients` tables.
 *
 * Ground truth: research doc sections 1.3 (campaigns, composite of 5
 * migrations) and the campaign_recipients base DDL + its four ALTERs, all
 * shipped in `packages/schema-crm/migrations/`.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/** `campaigns.status` CHECK (20260210000000); nullable column, DEFAULT 'draft'. */
export const campaignStatusSchema = z.enum([
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "cancelled",
  "sent",
]);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

/**
 * `campaigns.campaign_type` CHECK as replaced by 20260614233000 — includes
 * 'email' (the stale app-local union omits it).
 */
export const campaignTypeSchema = z.enum(["voice", "sms", "whatsapp", "multi_channel", "email"]);
export type CampaignType = z.infer<typeof campaignTypeSchema>;

/**
 * `campaigns` row — exactly the 32 effective columns: base table plus
 * `deleted_at` (soft delete), `timezone`, the four multi-turn guard columns
 * (NOT NULL with defaults 10/120/50/60), and the marketing provider columns.
 * TIME columns serialize as "HH:MM:SS" strings.
 */
export const campaignRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    name: z.string(),
    description: z.string().nullable(),
    status: campaignStatusSchema.nullable(),
    campaign_type: campaignTypeSchema,
    assistant_id: z.string().nullable(),
    from_number: z.string().nullable(),
    message_template: z.string().nullable(),
    schedule_start: timestamptz.nullable(),
    schedule_end: timestamptz.nullable(),
    calling_window_start: z.string().nullable(),
    calling_window_end: z.string().nullable(),
    calling_days: z.array(z.number().int()).nullable(),
    max_attempts: z.number().int().nullable(),
    retry_delay_minutes: z.number().int().nullable(),
    max_concurrent_calls: z.number().int().nullable(),
    calls_per_minute: z.number().int().nullable(),
    settings: jsonb.nullable(),
    created_by: uuid.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
    deleted_at: timestamptz.nullable(),
    timezone: z.string().nullable(),
    max_conversation_turns: z.number().int(),
    no_reply_timeout_minutes: z.number().int(),
    max_sends_per_recipient: z.number().int(),
    global_send_rate_per_minute: z.number().int(),
    provider: z.string().nullable(),
    provider_campaign_id: z.string().nullable(),
    template_ref: z.string().nullable(),
    segment_ref: z.string().nullable(),
  })
  .strict();

export const campaignInsertSchema = campaignRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    name: z.string(),
    campaign_type: campaignTypeSchema,
  })
  .strict();

/** Partial patch for UPDATE (`updated_at` is owned by the DB trigger — never send it). */
export const campaignUpdateSchema = campaignRowSchema.partial();

export type CampaignRow = z.infer<typeof campaignRowSchema>;
export type CampaignInsert = z.infer<typeof campaignInsertSchema>;
export type CampaignUpdate = z.infer<typeof campaignUpdateSchema>;

/** `campaign_recipients.status` CHECK (20260210000000); nullable, DEFAULT 'pending'. */
export const campaignRecipientStatusSchema = z.enum([
  "pending",
  "scheduled",
  "in_progress",
  "completed",
  "failed",
  "skipped",
  "opted_out",
  "no_answer",
  "voicemail",
]);
export type CampaignRecipientStatus = z.infer<typeof campaignRecipientStatusSchema>;

/**
 * `campaign_recipients` row — exactly the 31 effective columns: base table
 * (contact snapshot + execution state) plus the conversation state, retry,
 * provider, and engagement ALTERs. `conversation_status` is NOT NULL DEFAULT
 * 'not_started' with NO CHECK constraint (plain string).
 */
export const campaignRecipientRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    campaign_id: uuid,
    list_id: uuid.nullable(),
    contact_id: uuid.nullable(),
    first_name: z.string(),
    last_name: z.string().nullable(),
    phone: z.string(),
    email: z.string().nullable(),
    timezone: z.string().nullable(),
    client_type: z.string().nullable(),
    custom_fields: jsonb.nullable(),
    status: campaignRecipientStatusSchema.nullable(),
    scheduled_at: timestamptz.nullable(),
    attempts: z.number().int().nullable(),
    last_attempt_at: timestamptz.nullable(),
    completed_at: timestamptz.nullable(),
    call_control_id: z.string().nullable(),
    conversation_id: z.string().nullable(),
    result: jsonb.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
    conversation_status: z.string(),
    last_turn_at: timestamptz.nullable(),
    turn_count: z.number().int(),
    sms_opt_out: z.boolean(),
    retry_attempts: z.number().int(),
    last_inbound_at: timestamptz.nullable(),
    provider_recipient_id: z.string().nullable(),
    provider_message_id: z.string().nullable(),
    engagement: jsonb.nullable(),
  })
  .strict();

export const campaignRecipientInsertSchema = campaignRecipientRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    campaign_id: uuid,
    first_name: z.string(),
    phone: z.string(),
  })
  .strict();

export const campaignRecipientUpdateSchema = campaignRecipientRowSchema.partial();

export type CampaignRecipientRow = z.infer<typeof campaignRecipientRowSchema>;
export type CampaignRecipientInsert = z.infer<typeof campaignRecipientInsertSchema>;
export type CampaignRecipientUpdate = z.infer<typeof campaignRecipientUpdateSchema>;
