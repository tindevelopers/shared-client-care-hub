import { z } from "zod";

/**
 * Zod schemas for the `contacts` and `contact_channels` tables.
 *
 * Ground truth: docs/superpowers/research/2026-09-13-crm-schema-ground-truth.md
 * (section 1.1 and 1.8) composed from the migrations shipped in
 * `packages/schema-crm/migrations/`.
 */

/** Postgres `timestamptz` as serialized by PostgREST/Supabase (ISO 8601 string). */
const timestamptz = z.string();
/** Postgres `uuid` (all id/FK columns). */
const uuid = z.string().uuid();
/** Postgres `jsonb` — a JSON object. Nullable variants are explicit per column. */
const jsonb = z.record(z.unknown());

/**
 * `contacts` row — exactly the 30 effective columns from the DDL.
 *
 * NOT NULL columns with defaults parse as non-null on rows:
 * `sms_opt_out` (false), `email_opt_out` (false), `email_valid` (true),
 * `whatsapp_opt_out` (false), `dnc` (false), `tags`/`address`/`custom_fields`
 * (nullable JSONB/TEXT[] with '{}' defaults).
 *
 * Drift note: `lifecycle_stage`, `score`, and `do_not_contact` are referenced
 * by app code but DO NOT EXIST in the DDL or the hosted DB — the strict object
 * rejects them as unrecognized keys.
 */
export const contactRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    company_id: uuid.nullable(),
    first_name: z.string(),
    last_name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    mobile: z.string().nullable(),
    job_title: z.string().nullable(),
    department: z.string().nullable(),
    address: jsonb.nullable(),
    avatar_url: z.string().nullable(),
    tags: z.array(z.string()).nullable(),
    custom_fields: jsonb.nullable(),
    notes: z.string().nullable(),
    created_by: uuid.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
    /**
     * DDL columns from 20260320100000_add_contact_sync_tracking.sql that are
     * NOT yet present on the hosted DB (PostgREST: "column does not exist").
     * Optional so real hosted rows (28 keys) still parse; the schema keeps
     * modeling the full 30-column DDL ground truth.
     */
    ghl_contact_id: z.string().nullable().optional(),
    ghl_last_synced_at: timestamptz.nullable().optional(),
    sms_opt_out: z.boolean(),
    email_opt_out: z.boolean(),
    email_valid: z.boolean(),
    phone_e164: z.string().nullable(),
    whatsapp_id: z.string().nullable(),
    last_inbound_at: timestamptz.nullable(),
    last_contacted_at: timestamptz.nullable(),
    assigned_to: uuid.nullable(),
    whatsapp_opt_out: z.boolean(),
    dnc: z.boolean(),
  })
  .strict();

/** Columns a caller must supply to INSERT a contact (rest have DB defaults / are nullable). */
export const contactInsertSchema = contactRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    first_name: z.string(),
    last_name: z.string(),
  })
  .strict();

/** Partial patch for UPDATE (`updated_at` is owned by the DB trigger — never send it). */
export const contactUpdateSchema = contactRowSchema.partial();

export type ContactRow = z.infer<typeof contactRowSchema>;
export type ContactInsert = z.infer<typeof contactInsertSchema>;
export type ContactUpdate = z.infer<typeof contactUpdateSchema>;

/** `contact_channels.channel` CHECK constraint (20260615000001). */
export const contactChannelTypeSchema = z.enum(["sms", "whatsapp", "email", "voice"]);
export type ContactChannelType = z.infer<typeof contactChannelTypeSchema>;

/**
 * `contact_channels` row — 10 columns; UNIQUE (tenant_id, channel,
 * normalized_address) per constraint contact_channels_tenant_channel_addr_unique.
 * `metadata` and `is_primary` are NOT NULL with defaults ('{}' / false).
 */
export const contactChannelRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    contact_id: uuid,
    channel: contactChannelTypeSchema,
    address: z.string(),
    normalized_address: z.string(),
    is_primary: z.boolean(),
    metadata: jsonb,
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

export const contactChannelInsertSchema = contactChannelRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    contact_id: uuid,
    channel: contactChannelTypeSchema,
    address: z.string(),
    normalized_address: z.string(),
  })
  .strict();

export const contactChannelUpdateSchema = contactChannelRowSchema.partial();

export type ContactChannelRow = z.infer<typeof contactChannelRowSchema>;
export type ContactChannelInsert = z.infer<typeof contactChannelInsertSchema>;
export type ContactChannelUpdate = z.infer<typeof contactChannelUpdateSchema>;
