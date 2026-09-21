import type {
  CampaignRecipientStatus,
  CampaignRow,
  CampaignStatus,
  CampaignType,
} from "@tindevelopers/schema-crm";
import type { Page } from "../core/result.js";
import type { ContactSummaryVm } from "../contacts/types.js";

export interface CampaignQuery {
  search?: string;
  status?: CampaignStatus;
  type?: CampaignType;
  limit: number;
  offset: number;
}

export type CampaignSummaryVm = Pick<
  CampaignRow,
  | "id"
  | "name"
  | "description"
  | "status"
  | "campaign_type"
  | "schedule_start"
  | "schedule_end"
  | "provider"
  | "created_at"
  | "updated_at"
>;
export type CampaignPage = Page<CampaignSummaryVm>;
export type CampaignDetailVm = CampaignRow;

export type CampaignInput = Pick<CampaignRow, "name" | "campaign_type"> &
  Partial<
    Pick<
      CampaignRow,
      | "description"
      | "schedule_start"
      | "schedule_end"
      | "calling_window_start"
      | "calling_window_end"
      | "calling_days"
      | "timezone"
      | "message_template"
      | "settings"
    >
  >;
export type CampaignPatch = Partial<CampaignInput>;

export type CampaignLifecycleAction =
  | "schedule"
  | "start"
  | "pause"
  | "resume"
  | "complete"
  | "cancel";

/**
 * Mirrors `packages/domain-campaigns/src/campaign-store.ts`'s `transitions`
 * table exactly. `ui-crm` stays domain-package-free, so the canonical
 * lifecycle shape is duplicated here rather than imported.
 */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignLifecycleAction[]> = {
  draft: ["schedule", "start", "cancel"],
  scheduled: ["start", "pause", "cancel"],
  running: ["pause", "complete", "cancel"],
  paused: ["resume", "cancel"],
  sent: ["complete"],
  completed: [],
  cancelled: [],
};

export const CAMPAIGN_LIFECYCLE_LABELS: Record<CampaignLifecycleAction, string> = {
  schedule: "Schedule campaign",
  start: "Start campaign",
  pause: "Pause campaign",
  resume: "Resume campaign",
  complete: "Complete campaign",
  cancel: "Cancel campaign",
};

export interface CampaignStatsVm {
  total: number;
  pending: number;
  scheduled: number;
  inProgress: number;
  completed: number;
  failed: number;
  skipped: number;
  optedOut: number;
  noAnswer: number;
  voicemail: number;
}

export interface RecipientQuery {
  status?: CampaignRecipientStatus;
  limit: number;
  offset: number;
}

export interface CampaignRecipientVm {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  timezone: string | null;
  status: CampaignRecipientStatus;
  scheduledAt: string | null;
  attempts: number;
  completedAt: string | null;
}
export type CampaignRecipientPage = Page<CampaignRecipientVm>;

export interface AudiencePreviewVm {
  total: number;
  sample: ContactSummaryVm[];
}

export type CampaignAudience =
  | { type: "all_contacts" }
  | { type: "list"; listId: string }
  | { type: "tag"; tag: string }
  | { type: "contacts"; contactIds: string[] };
