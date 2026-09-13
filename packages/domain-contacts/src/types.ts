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

// ─── System tier (createSystemContactsStore) ───────────────────────────────

/**
 * Suppression classification outcome, as computed by the suppression
 * subscriber's bounce classification before it reaches the store (W12–W14):
 * - `unsubscribe` → `email_opt_out` only
 * - `hard-bounce` → `email_opt_out` + `email_valid: false`
 * - `soft-bounce` → timeline only; the store never writes `contacts`
 */
export type SuppressionKind = "unsubscribe" | "hard-bounce" | "soft-bounce";

/**
 * Emitter for the `contact.unsubscribed` re-emit on the email-lookup
 * suppression path (W13). Structurally compatible with core-kernel's
 * `emit('contact.unsubscribed', …)` so the app can inject it directly.
 */
export type ContactUnsubscribedEmit = (
  type: "contact.unsubscribed",
  envelope: {
    idempotencyKey: string;
    actor: { type: "system" };
    refs: { tenantId: string; contactId: string };
    data: { email: string; channel: "email" };
  },
) => Promise<unknown> | void;

/** Brevo sync-state metadata (`sync_state.metadata`, ground truth "Adjacent write"). */
export type BrevoSyncMetadata = { hash?: string; brevoId?: string };

/**
 * The event-driven part of the projection intent (`EVENT_ACTION_MAP` entry):
 * attributes to force, list memberships, and the lifecycle stage to set.
 * Row-derived fields come from the contacts row itself.
 */
export interface ProjectionAction {
  setAttributes?: Record<string, string | number | boolean | null>;
  listAdd?: string[];
  listRemove?: string[];
  setLifecycleStage?:
    | "visitor"
    | "lead"
    | "mql"
    | "sql"
    | "opportunity"
    | "customer"
    | "churned"
    | "reactivated";
}

/**
 * Canonical contact projection built from a `contacts` row
 * (`crm-sync-service.ts` buildProjection / integrations
 * `ContactProjection` field set). `score` is always undefined against the
 * hosted schema (the column does not exist — ground-truth drift).
 */
export interface ContactProjection {
  /** Konnect contacts.id — the SoR primary key. */
  konnectContactId: string;
  /** Tenant identifier. */
  tenantId: string;
  /** Primary email. Required for Brevo (email is the merge key). */
  email?: string;
  /** Phone number (E.164). */
  phone?: string;
  /** First name. */
  firstName?: string;
  /** Last name. */
  lastName?: string;
  /** Arbitrary attributes (action-set + scalar custom_fields). */
  attributes: Record<string, string | number | boolean | null>;
  /** Konnect lifecycle stage (action-driven; no row column exists). */
  lifecycleStage?: ProjectionAction["setLifecycleStage"];
  /** Konnect lead/contact score (no row column on the hosted schema). */
  score?: number;
  /** Logical list keys to add the contact to. */
  listKeys: string[];
  /** Logical list keys to remove the contact from. */
  removeListKeys?: string[];
  /** Whether the contact has opted out of email (action-driven). */
  emailOptOut?: boolean;
  /** Whether the contact has opted out of SMS. */
  smsOptOut?: boolean;
}
