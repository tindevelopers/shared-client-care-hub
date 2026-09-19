import { z } from "zod";

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

export const suppressionChannelSchema = z.enum(["email", "sms", "whatsapp"]);
export type SuppressionChannel = z.infer<typeof suppressionChannelSchema>;

export const contactSuppressionRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    contact_id: uuid,
    channel: suppressionChannelSchema,
    suppressed: z.boolean(),
    reason: z.string().nullable(),
    source: z.string(),
    metadata: jsonb,
    /** Canonical actor column: who last set/unset the suppression (NULL = system). */
    updated_by: uuid.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

/** Columns a caller must supply to UPSERT a suppression (rest have defaults). */
export const contactSuppressionInsertSchema = contactSuppressionRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    contact_id: uuid,
    channel: suppressionChannelSchema,
    source: z.string(),
  })
  .strict();

export type ContactSuppressionRow = z.infer<typeof contactSuppressionRowSchema>;
export type ContactSuppressionInsert = z.infer<typeof contactSuppressionInsertSchema>;
