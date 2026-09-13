import type { ContactInsert, ContactRow, ContactUpdate } from "@tindevelopers/schema-crm";

/**
 * Columns writable only through the system-tier store (`createSystemContactsStore`)
 * — the service-role writers W1–W3, W12–W16, and W20–W22 own them. The tenant
 * tier must never send them (ground truth 4.2).
 */
export type ServiceRoleContactColumn =
  | "last_inbound_at"
  | "last_contacted_at"
  | "phone_e164"
  | "email_opt_out"
  | "email_valid"
  | "sms_opt_out"
  | "ghl_contact_id"
  | "ghl_last_synced_at";

/** Columns the store injects (never caller-supplied) on tenant-tier inserts. */
type StoreInjectedInsertColumn = "tenant_id";

/**
 * Columns never updatable through the tenant tier: identity/audit columns and
 * `updated_at` (owned by the DB BEFORE UPDATE trigger — ground truth 4.4 item 1)
 * on top of the service-role-only set.
 */
type StoreOwnedUpdateColumn = "id" | "tenant_id" | "created_at" | "updated_at" | "created_by";

/** Insert payload for the tenant tier; the store injects `tenant_id`. */
export type TenantContactInsert = Omit<ContactInsert, StoreInjectedInsertColumn | ServiceRoleContactColumn>;

/** Partial update payload for the tenant tier (W5/W10 `updates` shape, narrowed). */
export type TenantContactUpdate = Omit<ContactUpdate, StoreOwnedUpdateColumn | ServiceRoleContactColumn>;

/**
 * `companies(*)` row as returned by the `company:companies(*)` join select
 * (W4/W5 reader shape). `companies` is not a CRM-owned table, so its row type
 * lives here rather than in schema-crm.
 */
export type ContactCompany = {
  id: string;
  tenant_id: string;
  name: string;
  website: string | null;
  industry: string | null;
  size: string | null;
  annual_revenue: number | null;
  description: string | null;
  address: Record<string, unknown> | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Contact row with the joined company (W4/W5 `.select("*, company:companies(*)")` shape). */
export type ContactWithCompany = ContactRow & { company?: ContactCompany | null };

/** Dialing UI dropdown option (`listContactDialTargetsAction` shape). */
export type ContactDialTarget = { value: string; label: string };
