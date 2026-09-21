export type { CrmCapabilities } from "./core/capabilities";
export { DENY_ALL_CRM_CAPABILITIES } from "./core/capabilities";
export type { CrmNavigation } from "./core/navigation";
export type {
  AnalyticsExtension,
  AudienceSourceExtension,
  AudienceSourceExtensionDefinition,
  CampaignChannelExtension,
  CampaignChannelExtensionDefinition,
  JsonValue,
  ProviderPanelProps,
} from "./core/provider-extensions";
export {
  defineAudienceSourceExtension,
  defineCampaignChannelExtension,
} from "./core/provider-extensions";
export type { CrmUiError, CrmUiResult, Page } from "./core/result";
