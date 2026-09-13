import { z } from "zod";

/**
 * Zod schemas for the sync bookkeeping tables: `contact_sync_log` (GHL,
 * 20260320100000) and `sync_state` + `field_mappings` (provider-agnostic,
 * 20260603120000).
 */

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/** `contact_sync_log.direction` CHECK (20260320100000). */
export const contactSyncDirectionSchema = z.enum(["inbound", "outbound"]);
export type ContactSyncDirection = z.infer<typeof contactSyncDirectionSchema>;

/** `contact_sync_log.action` CHECK (20260320100000). */
export const contactSyncActionSchema = z.enum(["created", "updated", "skipped", "error"]);
export type ContactSyncAction = z.infer<typeof contactSyncActionSchema>;

/**
 * `contact_sync_log` row — 8 columns; append-only audit trail. `tenant_id` is
 * a NULLABLE FK and `konnect_contact_id` has no FK constraint (both per DDL).
 */
export const contactSyncLogRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid.nullable(),
    direction: contactSyncDirectionSchema,
    konnect_contact_id: uuid.nullable(),
    ghl_contact_id: z.string().nullable(),
    action: contactSyncActionSchema,
    error_message: z.string().nullable(),
    synced_at: timestamptz,
  })
  .strict();

export const contactSyncLogInsertSchema = contactSyncLogRowSchema
  .omit({ id: true, synced_at: true })
  .partial()
  .extend({
    direction: contactSyncDirectionSchema,
    action: contactSyncActionSchema,
  })
  .strict();

export const contactSyncLogUpdateSchema = contactSyncLogRowSchema.partial();

export type ContactSyncLogRow = z.infer<typeof contactSyncLogRowSchema>;
export type ContactSyncLogInsert = z.infer<typeof contactSyncLogInsertSchema>;
export type ContactSyncLogUpdate = z.infer<typeof contactSyncLogUpdateSchema>;

/** `sync_state.entity_type` CHECK (20260603120000). */
export const syncEntityTypeSchema = z.enum(["contact", "company", "deal"]);
export type SyncEntityType = z.infer<typeof syncEntityTypeSchema>;

/** `sync_state.last_sync_direction` CHECK; NOT NULL DEFAULT 'out'. */
export const syncDirectionSchema = z.enum(["in", "out"]);
export type SyncDirection = z.infer<typeof syncDirectionSchema>;

/**
 * `sync_state` row — 11 columns; UNIQUE (entity_type, entity_id, provider_slug)
 * per sync_state_entity_provider_unique. `metadata` is NOT NULL DEFAULT '{}'
 * (Brevo uses { hash, brevoId }). Writes are service-role only (RLS: tenant
 * SELECT).
 */
export const syncStateRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    entity_type: syncEntityTypeSchema,
    entity_id: uuid,
    provider_slug: z.string(),
    last_synced_at: timestamptz,
    last_sync_direction: syncDirectionSchema,
    conflict_flag: z.boolean(),
    metadata: jsonb,
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

export const syncStateInsertSchema = syncStateRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    entity_type: syncEntityTypeSchema,
    entity_id: uuid,
    provider_slug: z.string(),
  })
  .strict();

export const syncStateUpdateSchema = syncStateRowSchema.partial();

export type SyncStateRow = z.infer<typeof syncStateRowSchema>;
export type SyncStateInsert = z.infer<typeof syncStateInsertSchema>;
export type SyncStateUpdate = z.infer<typeof syncStateUpdateSchema>;

/** `field_mappings.entity` CHECK (20260603120000). */
export const fieldMappingEntitySchema = z.enum(["contact", "company", "deal"]);
export type FieldMappingEntity = z.infer<typeof fieldMappingEntitySchema>;

/** `field_mappings.direction` CHECK; NOT NULL DEFAULT 'bidirectional'. */
export const fieldMappingDirectionSchema = z.enum(["in", "out", "bidirectional"]);
export type FieldMappingDirection = z.infer<typeof fieldMappingDirectionSchema>;

/** `field_mappings.conflict_policy` CHECK; NOT NULL DEFAULT 'newest_wins'. */
export const fieldMappingConflictPolicySchema = z.enum([
  "external_wins",
  "internal_wins",
  "newest_wins",
]);
export type FieldMappingConflictPolicy = z.infer<typeof fieldMappingConflictPolicySchema>;

/**
 * `field_mappings` row — 10 columns; UNIQUE (tenant_id, provider_slug, entity,
 * internal_field) per field_mappings_unique_mapping.
 */
export const fieldMappingRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    provider_slug: z.string(),
    entity: fieldMappingEntitySchema,
    internal_field: z.string(),
    external_field: z.string(),
    direction: fieldMappingDirectionSchema,
    conflict_policy: fieldMappingConflictPolicySchema,
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

export const fieldMappingInsertSchema = fieldMappingRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    provider_slug: z.string(),
    entity: fieldMappingEntitySchema,
    internal_field: z.string(),
    external_field: z.string(),
  })
  .strict();

export const fieldMappingUpdateSchema = fieldMappingRowSchema.partial();

export type FieldMappingRow = z.infer<typeof fieldMappingRowSchema>;
export type FieldMappingInsert = z.infer<typeof fieldMappingInsertSchema>;
export type FieldMappingUpdate = z.infer<typeof fieldMappingUpdateSchema>;
