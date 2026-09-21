import { createElement, type ComponentType } from "react";
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
  initialValue?: TConfig;
  Panel: ComponentType<ProviderPanelProps<TConfig>>;
  validate(value: TConfig): CrmUiResult<void>;
  serialize(value: TConfig): JsonValue;
}

export interface CampaignChannelExtension<TConfig extends JsonValue = JsonValue> {
  id: string;
  label: string;
  initialValue?: TConfig;
  Panel: ComponentType<ProviderPanelProps<TConfig>>;
  validate(value: TConfig): CrmUiResult<void>;
  serialize(value: TConfig): JsonValue;
}

export interface AudienceSourceExtensionDefinition {
  id: string;
  label: string;
  initialValue: JsonValue;
  Panel: ComponentType<ProviderPanelProps<JsonValue>>;
  validate(value: JsonValue): CrmUiResult<void>;
  serialize(value: JsonValue): JsonValue;
}

export interface CampaignChannelExtensionDefinition {
  id: string;
  label: string;
  initialValue: JsonValue;
  Panel: ComponentType<ProviderPanelProps<JsonValue>>;
  validate(value: JsonValue): CrmUiResult<void>;
  serialize(value: JsonValue): JsonValue;
}

export function defineAudienceSourceExtension<TConfig extends JsonValue>(
  extension: AudienceSourceExtension<TConfig> & { initialValue: TConfig },
): AudienceSourceExtensionDefinition {
  const TypedPanel = extension.Panel;
  return {
    id: extension.id,
    label: extension.label,
    initialValue: extension.initialValue,
    Panel: ({ value, disabled, onChange }) =>
      createElement(TypedPanel, { value: value as TConfig, disabled, onChange }),
    validate: (value) => extension.validate(value as TConfig),
    serialize: (value) => extension.serialize(value as TConfig),
  };
}

export function defineCampaignChannelExtension<TConfig extends JsonValue>(
  extension: CampaignChannelExtension<TConfig> & { initialValue: TConfig },
): CampaignChannelExtensionDefinition {
  const TypedPanel = extension.Panel;
  return {
    id: extension.id,
    label: extension.label,
    initialValue: extension.initialValue,
    Panel: ({ value, disabled, onChange }) =>
      createElement(TypedPanel, { value: value as TConfig, disabled, onChange }),
    validate: (value) => extension.validate(value as TConfig),
    serialize: (value) => extension.serialize(value as TConfig),
  };
}

export interface AnalyticsExtension {
  id: string;
  label: string;
  Panel: ComponentType<{ campaignId: string; data: JsonValue }>;
}
