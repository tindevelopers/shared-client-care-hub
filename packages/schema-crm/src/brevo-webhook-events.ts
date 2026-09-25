import { z } from "zod";

/**
 * Zod schemas for the `brevo_webhook_events` table.
 *
 * Ground truth: `packages/schema-crm/migrations/20260614230000_brevo_webhooks_activities_suppression.sql`
 * (lines 10-23). No later migration alters this table.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/**
 * `brevo_webhook_events` row — 12 columns; raw webhook payload store for
 * async processing. `payload` is `NOT NULL` (no default, unlike most other
 * JSONB columns in this package). `event_type` is plain `TEXT` with no CHECK
 * constraint.
 */
export const brevoWebhookEventRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid.nullable(),
    connection_id: uuid.nullable(),
    event_type: z.string(),
    external_event_id: z.string(),
    payload: jsonb,
    processed: z.boolean(),
    processed_at: timestamptz.nullable(),
    retry_count: z.number().int(),
    error: z.string().nullable(),
    received_at: timestamptz,
    created_at: timestamptz,
  })
  .strict();

/** Columns a caller must supply to INSERT a webhook event (rest have DB defaults / are nullable). */
export const brevoWebhookEventInsertSchema = brevoWebhookEventRowSchema
  .omit({ id: true, received_at: true, created_at: true })
  .partial()
  .extend({
    event_type: z.string(),
    external_event_id: z.string(),
    payload: jsonb,
  })
  .strict();

/** Partial patch for UPDATE (used to mark a webhook event processed / record a retry). */
export const brevoWebhookEventUpdateSchema = brevoWebhookEventRowSchema.partial();

export type BrevoWebhookEventRow = z.infer<typeof brevoWebhookEventRowSchema>;
export type BrevoWebhookEventInsert = z.infer<typeof brevoWebhookEventInsertSchema>;
export type BrevoWebhookEventUpdate = z.infer<typeof brevoWebhookEventUpdateSchema>;
