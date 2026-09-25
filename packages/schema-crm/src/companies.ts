import { z } from "zod";

/**
 * Zod schemas for the `companies` table.
 *
 * Ground truth: `packages/schema-crm/migrations/20251208000000_create_crm_tables.sql`
 * (lines 9-28). No later migration alters this table.
 */

const timestamptz = z.string();
const uuid = z.string().uuid();
const jsonb = z.record(z.unknown());

/** `companies.size` CHECK constraint (20251208000000); nullable, no default. */
export const companySizeSchema = z.enum([
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1000+",
]);
export type CompanySize = z.infer<typeof companySizeSchema>;

/**
 * `companies` row — 17 columns. `UNIQUE(tenant_id, name)` (companies_tenant_name_unique)
 * is a DB-level constraint, not represented here.
 */
export const companyRowSchema = z
  .object({
    id: uuid,
    tenant_id: uuid,
    name: z.string(),
    website: z.string().nullable(),
    industry: z.string().nullable(),
    size: companySizeSchema.nullable(),
    annual_revenue: z.number().nullable(),
    description: z.string().nullable(),
    address: jsonb.nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    logo_url: z.string().nullable(),
    tags: z.array(z.string()).nullable(),
    custom_fields: jsonb.nullable(),
    created_by: uuid.nullable(),
    created_at: timestamptz,
    updated_at: timestamptz,
  })
  .strict();

/** Columns a caller must supply to INSERT a company (rest have DB defaults / are nullable). */
export const companyInsertSchema = companyRowSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .partial()
  .extend({
    tenant_id: uuid,
    name: z.string(),
  })
  .strict();

/** Partial patch for UPDATE (`updated_at` is owned by the DB trigger — never send it). */
export const companyUpdateSchema = companyRowSchema.partial();

export type CompanyRow = z.infer<typeof companyRowSchema>;
export type CompanyInsert = z.infer<typeof companyInsertSchema>;
export type CompanyUpdate = z.infer<typeof companyUpdateSchema>;
