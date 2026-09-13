import type { CampaignInsert, CampaignRow, CampaignUpdate } from "@tindevelopers/schema-crm";

/**
 * Campaigns domain types.
 *
 * `CampaignStats` and `CampaignRecipientProjection` mirror the shapes in
 * `apps/app/app/actions/campaigns/campaigns.ts` exactly (lines 50-61 and
 * 264-282) — they are the read-parity contract for the store's stats and
 * recipient methods.
 */

/** Exact CampaignStats shape from campaigns.ts:50-61 (getCampaignStats). */
export interface CampaignStats {
  total: number;
  pending: number;
  scheduled: number;
  in_progress: number;
  completed: number;
  failed: number;
  skipped: number;
  opted_out: number;
  no_answer: number;
  voicemail: number;
}

/**
 * The exact 13-column projection returned by getCampaignRecipients
 * (campaigns.ts:264-282, 279). Field nullability matches the action's
 * CampaignRecipient type.
 */
export interface CampaignRecipientProjection {
  id: string;
  campaign_id: string;
  first_name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
  timezone: string;
  client_type: string | null;
  status: string;
  scheduled_at: string | null;
  attempts: number;
  completed_at: string | null;
  created_at: string;
}

/** Options for listRecipients (getCampaignRecipients parity). */
export interface ListRecipientsOptions {
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Create input: any subset of the insert columns except `tenant_id` — the
 * store injects the bound tenant. Defaults are applied exactly as
 * createCampaign (campaigns.ts:109-128) does.
 */
export type CampaignCreateInput = Partial<Omit<CampaignInsert, "tenant_id">>;

/**
 * Update input: a partial patch of the row. `id`, `tenant_id`, `created_at`,
 * and `updated_at` are never writable through the store — the DB trigger
 * `update_campaigns_updated_at` owns `updated_at` (ground truth Part 4.4).
 */
export type CampaignUpdateInput = Omit<
  CampaignUpdate,
  "id" | "tenant_id" | "created_at" | "updated_at"
>;

/**
 * Tenant-tier campaign store — the campaigns-table access seam whose query
 * shapes mirror `apps/app/app/actions/campaigns/campaigns.ts` payload for
 * payload. Never constructs a Supabase client; receives one plus the tenant
 * id and binds every query to that tenant.
 */
export interface CampaignStore {
  /**
   * Live campaigns for the tenant, newest first (getCampaigns parity:
   * `deleted_at IS NULL`, `created_at DESC`).
   */
  list(): Promise<CampaignRow[]>;
  /**
   * One campaign by id (`select("*")` full row) or null when the id is
   * missing, soft-deleted, or belongs to another tenant (getCampaign parity:
   * PGRST116 → null).
   */
  get(id: string): Promise<CampaignRow | null>;
  /**
   * Insert a campaign with the exact createCampaign row defaults; resolves
   * with the new id. Rejects on insert errors.
   */
  create(input: CampaignCreateInput): Promise<string>;
  /**
   * Apply a partial patch to a campaign in this tenant (updateCampaign
   * parity: no `deleted_at` filter; `updated_at` is never sent — the DB
   * trigger owns it). A cross-tenant or missing id matches zero rows and
   * resolves without error, exactly like the action.
   */
  update(id: string, updates: CampaignUpdateInput): Promise<void>;
  /**
   * Soft-delete: sets `deleted_at` (now, ISO) and `status: "cancelled"` on
   * the live row (deleteCampaign parity: `.is("deleted_at", null)` guard).
   * The row physically remains. A cross-tenant, missing, or already-deleted
   * id matches zero rows and resolves without error.
   */
  softDelete(id: string): Promise<void>;
  /**
   * Tally of campaign_recipients.status into the exact CampaignStats shape
   * (getCampaignStats parity): unknown statuses increment `total` only;
   * resolves null on query error, like the action.
   */
  getStats(campaignId: string): Promise<CampaignStats | null>;
  /**
   * Recipients of a campaign: the exact 13-column projection, newest first,
   * optional status filter, `range(offset, offset + limit - 1)` pagination
   * with limit defaulting to 100 and offset to 0 (getCampaignRecipients
   * parity).
   */
  listRecipients(
    campaignId: string,
    options?: ListRecipientsOptions,
  ): Promise<CampaignRecipientProjection[]>;
  /**
   * `Record<timezone, count>` over a campaign's recipients; null or empty
   * timezones bucket as "Unknown" (getRecipientTimezoneStats parity).
   */
  getRecipientTimezoneStats(campaignId: string): Promise<Record<string, number>>;
}
