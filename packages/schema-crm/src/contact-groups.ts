import { z } from "zod";

const timestamptz = z.string();
const uuid = z.string().uuid();

export const contactListKindSchema = z.enum(["list", "segment"]);
export type ContactListKind = z.infer<typeof contactListKindSchema>;

export const contactSegmentDefinitionSchema = z
  .object({
    tags: z.array(z.string()).optional(),
  })
  .strict();
export type ContactSegmentDefinition = z.infer<typeof contactSegmentDefinitionSchema>;

export const contactGroupRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    name: z.string(),
    description: z.string().nullable(),
    color: z.string().nullable(),
    created_by: uuid.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
    kind: contactListKindSchema,
    definition: contactSegmentDefinitionSchema.nullable(),
  })
  .strict();

export const contactGroupMemberRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    group_id: uuid,
    contact_id: uuid,
    added_at: timestamptz,
  })
  .strict();

export type ContactGroupRow = z.infer<typeof contactGroupRowSchema>;
export type ContactGroupMemberRow = z.infer<typeof contactGroupMemberRowSchema>;
