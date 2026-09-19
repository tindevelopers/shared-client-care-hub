import type { ComponentType } from "react";
import type { CrmUiResult } from "./result";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ProviderPanelProps<TConfig extends JsonValue> {
  value: TConfig;
  disabled: boolean;
  onChange(value: TConfig): void;
}

export interface AudienceSourceExtension<TConfig extends JsonValue = JsonValue> {
  id: string;
  label: string;
  Panel: ComponentType<ProviderPanelProps<TConfig>>;
  validate(value: TConfig): CrmUiResult<void>;
  serialize(value: TConfig): JsonValue;
}

export interface CampaignChannelExtension<TConfig extends JsonValue = JsonValue> {
  id: string;
  label: string;
  Panel: ComponentType<ProviderPanelProps<TConfig>>;
  validate(value: TConfig): CrmUiResult<void>;
  serialize(value: TConfig): JsonValue;
}

export interface AnalyticsExtension {
  id: string;
  label: string;
  Panel: ComponentType<{ campaignId: string; data: JsonValue }>;
}
