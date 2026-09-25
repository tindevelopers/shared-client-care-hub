import { z } from "zod";

/**
 * Zod schemas for the `custom_field_definitions` table.
 *
 * Ground truth: `packages/schema-crm/migrations/20260603100000_create_custom_field_definitions.sql`.
 * No later migration alters this table.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/** `custom_field_definitions.entity` CHECK constraint. */
export const customFieldEntitySchema = z.enum(["contact", "company", "deal"]);
export type CustomFieldEntity = z.infer<typeof customFieldEntitySchema>;

/** `custom_field_definitions.field_type` CHECK constraint. */
export const customFieldTypeSchema = z.enum([
  "text",
  "number",
  "date",
  "select",
  "multiselect",
  "boolean",
  "url",
  "email",
  "phone",
]);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

/**
 * `custom_field_definitions` row — 11 columns.
 * `UNIQUE(tenant_id, entity, key)` (custom_field_definitions_tenant_entity_key_unique)
 * is a DB-level constraint, not represented here.
 */
export const customFieldDefinitionRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    entity: customFieldEntitySchema,
    key: z.string(),
    label: z.string(),
    field_type: customFieldTypeSchema,
    options: z.array(z.unknown()),
    required: z.boolean(),
    position: z.number(),
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

/** Columns a caller must supply to INSERT a custom field definition (rest have DB defaults). */
export const customFieldDefinitionInsertSchema = customFieldDefinitionRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    entity: customFieldEntitySchema,
    key: z.string(),
    label: z.string(),
    field_type: customFieldTypeSchema,
  })
  .strict();

/** Partial patch for UPDATE (`updated_at` is owned by the DB trigger — never send it). */
export const customFieldDefinitionUpdateSchema = customFieldDefinitionRowSchema.partial();

export type CustomFieldDefinitionRow = z.infer<typeof customFieldDefinitionRowSchema>;
export type CustomFieldDefinitionInsert = z.infer<typeof customFieldDefinitionInsertSchema>;
export type CustomFieldDefinitionUpdate = z.infer<typeof customFieldDefinitionUpdateSchema>;
