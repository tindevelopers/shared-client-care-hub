import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignRow } from "@tindevelopers/schema-crm";
import type {
  CampaignCreateInput,
  CampaignRecipientProjection,
  CampaignStats,
  CampaignStore,
  CampaignUpdateInput,
  ListRecipientsOptions,
} from "./types.js";

/**
 * Tenant-tier campaign store — owns every `campaigns` / `campaign_recipients`
 * query shape previously inlined in
 * `apps/app/app/actions/campaigns/campaigns.ts` (server actions stay as
 * authorization/audit adapters).
 *
 * Parity mapping (ground truth: the action file's query builders):
 * - `list`        ← getCampaigns              campaigns.ts:63-74
 * - `get`         ← getCampaign               campaigns.ts:76-90   (PGRST116 → null)
 * - `create`      ← createCampaign row builder campaigns.ts:109-128 (exact defaults)
 * - `update`      ← updateCampaign            campaigns.ts:145-149 (partial patch; no deleted_at filter)
 * - `softDelete`  ← deleteCampaign write      campaigns.ts:202-207 (deleted_at + cancelled, live rows only)
 * - `getStats`    ← getCampaignStats          campaigns.ts:246-262 (tally; unknown → total only; error → null)
 * - `listRecipients` ← getCampaignRecipients  campaigns.ts:275-294 (13-column projection, range pagination)
 * - `getRecipientTimezoneStats` ← getRecipientTimezoneStats campaigns.ts:305-318 ('Unknown' bucketing)
 *
 * Injection-only: the store receives a `SupabaseClient` and a `tenantId` and
 * binds every query to that tenant; it never constructs a client, never
 * imports core-kernel's admin client module, and never reads the
 * service-role key from the environment.
 */

/** The exact 13-column projection from getCampaignRecipients (campaigns.ts:279). */
const RECIPIENT_SELECT =
  "id, campaign_id, first_name, last_name, phone, email, timezone, client_type, status, scheduled_at, attempts, completed_at, created_at";

export function createCampaignStore(client: SupabaseClient, tenantId: string): CampaignStore {
  const campaigns = () => client.from("campaigns") as any;
  const recipients = () => client.from("campaign_recipients") as any;

  return {
    async list(): Promise<CampaignRow[]> {
      const { data, error } = await campaigns()
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as CampaignRow[]) ?? [];
    },

    async get(id: string): Promise<CampaignRow | null> {
      const { data, error } = await campaigns()
        .select("*")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data as CampaignRow;
    },

    async create(input: CampaignCreateInput): Promise<string> {
      // Exact row builder from createCampaign (campaigns.ts:109-128).
      const row = {
        tenant_id: tenantId,
        name: input.name ?? "Untitled Campaign",
        description: input.description ?? null,
        status: input.status ?? "draft",
        campaign_type: input.campaign_type ?? "voice",
        assistant_id: input.assistant_id ?? null,
        from_number: input.from_number ?? null,
        message_template: input.message_template ?? null,
        schedule_start: input.schedule_start ?? null,
        schedule_end: input.schedule_end ?? null,
        calling_window_start: input.calling_window_start ?? "09:00",
        calling_window_end: input.calling_window_end ?? "20:00",
        timezone: input.timezone ?? "UTC",
        calling_days: input.calling_days ?? [1, 2, 3, 4, 5],
        max_attempts: input.max_attempts ?? 3,
        retry_delay_minutes: input.retry_delay_minutes ?? 60,
        max_concurrent_calls: input.max_concurrent_calls ?? 5,
        calls_per_minute: input.calls_per_minute ?? 10,
        settings: input.settings ?? {},
      };

      const { data, error } = await campaigns()
        .insert(row)
        .select("id")
        .single();

      if (error) throw error;
      return (data as { id: string }).id;
    },

    async update(id: string, updates: CampaignUpdateInput): Promise<void> {
      const { error } = await campaigns()
        .update(updates)
        .eq("id", id)
        .eq("tenant_id", tenantId);

      if (error) throw error;
    },

    async softDelete(id: string): Promise<void> {
      const now = new Date().toISOString();

      const { error } = await campaigns()
        .update({ deleted_at: now, status: "cancelled" })
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .is("deleted_at", null);

      if (error) throw error;
    },

    async getStats(campaignId: string): Promise<CampaignStats | null> {
      const { data, error } = await recipients()
        .select("status")
        .eq("campaign_id", campaignId)
        .eq("tenant_id", tenantId);

      if (error) return null;

      const stats: CampaignStats = {
        total: 0,
        pending: 0,
        scheduled: 0,
        in_progress: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        opted_out: 0,
        no_answer: 0,
        voicemail: 0,
      };

      for (const row of (data ?? []) as { status: string }[]) {
        stats.total++;
        const s = row.status as keyof CampaignStats;
        if (s in stats && typeof stats[s] === "number") {
          (stats[s] as number)++;
        }
      }
      return stats;
    },

    async listRecipients(
      campaignId: string,
      options?: ListRecipientsOptions,
    ): Promise<CampaignRecipientProjection[]> {
      let q = recipients()
        .select(RECIPIENT_SELECT)
        .eq("campaign_id", campaignId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      if (options?.status) {
        q = q.eq("status", options.status);
      }
      const limit = options?.limit ?? 100;
      const offset = options?.offset ?? 0;
      q = q.range(offset, offset + limit - 1);

      const { data, error } = await q;
      if (error) throw error;
      return (data as CampaignRecipientProjection[]) ?? [];
    },

    async getRecipientTimezoneStats(campaignId: string): Promise<Record<string, number>> {
      const { data } = await recipients()
        .select("timezone")
        .eq("campaign_id", campaignId)
        .eq("tenant_id", tenantId);

      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { timezone: string }[]) {
        const tz = row.timezone || "Unknown";
        counts[tz] = (counts[tz] ?? 0) + 1;
      }
      return counts;
    },
  };
}
