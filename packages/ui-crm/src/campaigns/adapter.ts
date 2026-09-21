import type { CrmCapabilities } from "../core/capabilities.js";
import type { CrmNavigation } from "../core/navigation.js";
import type {
  AnalyticsExtension,
  AudienceSourceExtensionDefinition,
  CampaignChannelExtensionDefinition,
} from "../core/provider-extensions.js";
import type { CrmUiResult } from "../core/result.js";
import type {
  AudiencePreviewVm,
  CampaignAudience,
  CampaignDetailVm,
  CampaignInput,
  CampaignLifecycleAction,
  CampaignPage,
  CampaignPatch,
  CampaignQuery,
  CampaignRecipientPage,
  CampaignStatsVm,
  RecipientQuery,
} from "./types.js";

export interface CampaignsAdapter {
  listCampaigns(query?: CampaignQuery): Promise<CrmUiResult<CampaignPage>>;
  getCampaign(id: string): Promise<CrmUiResult<CampaignDetailVm | null>>;
  createCampaign(input: CampaignInput): Promise<CrmUiResult<{ id: string }>>;
  updateCampaign(id: string, patch: CampaignPatch): Promise<CrmUiResult<void>>;
  deleteCampaign(id: string): Promise<CrmUiResult<void>>;
  transitionCampaign(
    id: string,
    action: CampaignLifecycleAction,
  ): Promise<CrmUiResult<CampaignDetailVm>>;
  getStats(id: string): Promise<CrmUiResult<CampaignStatsVm>>;
  listRecipients(
    id: string,
    query?: RecipientQuery,
  ): Promise<CrmUiResult<CampaignRecipientPage>>;
  previewAudience(source: CampaignAudience): Promise<CrmUiResult<AudiencePreviewVm>>;
  replaceAudience(
    id: string,
    source: CampaignAudience,
  ): Promise<CrmUiResult<{ replaced: number }>>;
}

export interface CampaignsScreenProps {
  adapter: CampaignsAdapter;
  capabilities: CrmCapabilities;
  navigation: CrmNavigation;
  className?: string;
}
export interface CampaignWizardScreenProps extends CampaignsScreenProps {
  campaignId?: string;
  audienceExtensions?: AudienceSourceExtensionDefinition[];
  channelExtensions?: CampaignChannelExtensionDefinition[];
}
export interface CampaignDetailScreenProps extends CampaignsScreenProps {
  campaignId: string;
}
export type CampaignRecipientsScreenProps = CampaignDetailScreenProps;
export interface CampaignAnalyticsScreenProps extends CampaignDetailScreenProps {
  analyticsExtensions?: AnalyticsExtension[];
}
