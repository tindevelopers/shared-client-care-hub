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
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

export type ContactSuppressionRow = z.infer<typeof contactSuppressionRowSchema>;
