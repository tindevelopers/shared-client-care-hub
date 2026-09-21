import type {
  CampaignRecipientStatus,
  CampaignRow,
  CampaignStatus,
  CampaignType,
} from "@tindevelopers/schema-crm";
import type { ContactSummaryVm } from "../contacts/types.js";
import type { Page } from "../core/result.js";

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
