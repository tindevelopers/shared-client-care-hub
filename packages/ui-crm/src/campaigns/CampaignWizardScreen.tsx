import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CampaignType } from "@tindevelopers/schema-crm";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import type {
  AudienceSourceExtension,
  CampaignChannelExtension,
  JsonValue,
} from "../core/provider-extensions.js";
import type { CrmUiError, CrmUiResult } from "../core/result.js";
import type { CampaignWizardScreenProps } from "./adapter.js";
import type { AudiencePreviewVm, CampaignAudience, CampaignInput } from "./types.js";

const CAMPAIGN_TYPES: CampaignType[] = ["email", "sms", "whatsapp", "voice", "multi_channel"];
const EXTENSION_ERROR: CrmUiError = {
  code: "extension_error",
  message: "The extension configuration failed.",
  retryable: false,
};

type AudienceType = CampaignAudience["type"];

function configFor(
  configs: Record<string, JsonValue>,
  extension: AudienceSourceExtension | CampaignChannelExtension,
): JsonValue {
  return configs[extension.id] ?? extension.initialValue ?? null;
}

function extensionValue(
  extension: AudienceSourceExtension | CampaignChannelExtension,
  value: JsonValue,
): CrmUiResult<JsonValue> {
  try {
    const validated = extension.validate(value);
    if (!validated.ok) return validated;
    return { ok: true, data: extension.serialize(value) };
  } catch {
    return { ok: false, error: EXTENSION_ERROR };
  }
}

export function CampaignWizardScreen({
  adapter,
  capabilities,
  navigation,
  campaignId,
  audienceExtensions = [],
  channelExtensions = [],
  className,
}: CampaignWizardScreenProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CampaignType>("email");
  const [audienceType, setAudienceType] = useState<AudienceType>("all_contacts");
  const [listId, setListId] = useState("");
  const [tag, setTag] = useState("");
  const [contactIds, setContactIds] = useState("");
  const [audienceExtensionId, setAudienceExtensionId] = useState("");
  const [channelExtensionId, setChannelExtensionId] = useState("");
  const [audienceConfigs, setAudienceConfigs] = useState<Record<string, JsonValue>>({});
  const [channelConfigs, setChannelConfigs] = useState<Record<string, JsonValue>>({});
  const [loadedCampaignId, setLoadedCampaignId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const [extensionError, setExtensionError] = useState<CrmUiError | null>(null);
  const [preview, setPreview] = useState<AudiencePreviewVm | null>(null);
  const [previewError, setPreviewError] = useState<CrmUiError | null>(null);
  const [writeLocked, setWriteLocked] = useState(false);
  const request = useRef(0);
  const previewRequest = useRef(0);
  const writeLock = useRef(false);
  const allowed = campaignId ? capabilities.update : capabilities.create;
  const ready = !campaignId || loadedCampaignId === campaignId;
  const audienceExtension = audienceExtensions.find(({ id }) => id === audienceExtensionId);
  const channelExtension = channelExtensions.find(({ id }) => id === channelExtensionId);

  const audience: CampaignAudience =
    audienceType === "list" ? { type: "list", listId: listId.trim() } :
    audienceType === "tag" ? { type: "tag", tag: tag.trim() } :
    audienceType === "contacts" ? {
      type: "contacts",
      contactIds: contactIds.split(",").map((id) => id.trim()).filter(Boolean),
    } : { type: "all_contacts" };
  const audienceKey = JSON.stringify(audience);
  const audienceReady =
    (audience.type !== "list" || Boolean(audience.listId)) &&
    (audience.type !== "tag" || Boolean(audience.tag)) &&
    (audience.type !== "contacts" || audience.contactIds.length > 0);

  const scope = JSON.stringify({
    campaignId: campaignId ?? null,
    allowed: campaignId ? capabilities.update : capabilities.create,
    name, description, type, audience,
    audienceExtensionId, channelExtensionId,
    audienceConfig: audienceExtension
      ? configFor(audienceConfigs, audienceExtension) : null,
    channelConfig: channelExtension
      ? configFor(channelConfigs, channelExtension) : null,
  });
  const operation = useCrmOperation(scope);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const token = ++request.current;
    setLoadedCampaignId(null);
    setLoadError(null);
    const result = await safeAdapterCall(() => adapter.getCampaign(campaignId));
    if (token !== request.current) return;
    if (!result.ok) setLoadError(result.error);
    else if (!result.data) setLoadError({
      code: "not_found", message: "Campaign not found.", retryable: false,
    });
    else {
      setName(result.data.name);
      setDescription(result.data.description ?? "");
      setType(result.data.campaign_type);
      setLoadedCampaignId(campaignId);
    }
  }, [adapter, campaignId]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  useIsomorphicLayoutEffect(() => {
    if (!audienceExtensions.some(({ id }) => id === audienceExtensionId)) {
      setAudienceExtensionId("");
    }
  }, [audienceExtensionId, audienceExtensions]);
  useIsomorphicLayoutEffect(() => {
    if (!channelExtensions.some(({ id }) => id === channelExtensionId)) {
      setChannelExtensionId("");
    }
  }, [channelExtensionId, channelExtensions]);
  useIsomorphicLayoutEffect(() => {
    previewRequest.current += 1;
    setPreview(null);
    setPreviewError(null);
  }, [audienceKey]);

  async function previewAudience() {
    if (!audienceReady || writeLock.current) return;
    const token = ++previewRequest.current;
    setPreview(null);
    setPreviewError(null);
    const result = await safeAdapterCall(() => adapter.previewAudience(audience));
    if (token !== previewRequest.current) return;
    if (result.ok) setPreview(result.data);
    else setPreviewError(result.error);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!allowed || !name.trim() || writeLock.current) return;
    if (!audienceReady) return;

    setExtensionError(null);
    const settings: Record<string, JsonValue> = {};
    if (audienceExtension) {
      const value = extensionValue(
        audienceExtension,
        configFor(audienceConfigs, audienceExtension),
      );
      if (!value.ok) {
        setExtensionError(value.error);
        return;
      }
      settings.audienceExtension = { id: audienceExtension.id, config: value.data };
    }
    if (channelExtension) {
      const value = extensionValue(
        channelExtension,
        configFor(channelConfigs, channelExtension),
      );
      if (!value.ok) {
        setExtensionError(value.error);
        return;
      }
      settings.channelExtension = { id: channelExtension.id, config: value.data };
    }

    const input: CampaignInput = {
      name: name.trim(),
      campaign_type: type,
      description: description.trim() || null,
      settings: Object.keys(settings).length ? settings : null,
    };
    const selectedAudience = audience;
    let savedId = campaignId;
    let saved = false;
    const save = async (): Promise<CrmUiResult<{ id: string }>> => {
      if (!saved) {
        if (savedId) {
          const result = await adapter.updateCampaign(savedId, input);
          if (!result.ok) return result;
        } else {
          const result = await adapter.createCampaign(input);
          if (!result.ok) return result;
          savedId = result.data.id;
        }
        saved = true;
      }
      const targetId = savedId as string;
      const audienceResult = await adapter.replaceAudience(targetId, selectedAudience);
      if (!audienceResult.ok) return audienceResult;
      return { ok: true, data: { id: targetId } };
    };

    writeLock.current = true;
    setWriteLocked(true);
    try {
      await operation.start(save, ({ id }) => navigation.campaign(id));
    } finally {
      writeLock.current = false;
      setWriteLocked(false);
    }
  }

  async function retry() {
    if (writeLock.current) return;
    writeLock.current = true;
    setWriteLocked(true);
    try {
      await operation.retry();
    } finally {
      writeLock.current = false;
      setWriteLocked(false);
    }
  }

  const AudiencePanel = audienceExtension?.Panel;
  const ChannelPanel = channelExtension?.Panel;

  return (
    <main className={className}>
      <h1>{campaignId ? "Edit campaign" : "Create campaign"}</h1>
      {loadError && <ErrorNotice error={loadError} retryLabel="Retry loading campaign"
        onRetry={() => void load()} />}
      {ready && <form onSubmit={submit}>
        <label>
          Campaign name
          <input required disabled={writeLocked} value={name}
            onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Description
          <textarea disabled={writeLocked} value={description}
            onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label>
          Campaign type
          <select disabled={writeLocked} value={type}
            onChange={(event) => setType(event.target.value as CampaignType)}>
            {CAMPAIGN_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <fieldset disabled={writeLocked}>
          <legend>Audience</legend>
          <label>
            Audience type
            <select value={audienceType}
              onChange={(event) => setAudienceType(event.target.value as AudienceType)}>
              <option value="all_contacts">All contacts</option>
              <option value="list">List</option>
              <option value="tag">Tag</option>
              <option value="contacts">Selected contacts</option>
            </select>
          </label>
          {audienceType === "list" && <label>Audience list
            <input value={listId} onChange={(event) => setListId(event.target.value)} />
          </label>}
          {audienceType === "tag" && <label>Audience tag
            <input value={tag} onChange={(event) => setTag(event.target.value)} />
          </label>}
          {audienceType === "contacts" && <label>Contact IDs
            <input value={contactIds} onChange={(event) => setContactIds(event.target.value)} />
          </label>}
        </fieldset>
        <button type="button" disabled={writeLocked || !audienceReady}
          onClick={() => void previewAudience()}>
          Preview audience
        </button>
        {preview && <p role="status">{preview.total} contacts</p>}
        {previewError && <ErrorNotice error={previewError}
          retryLabel="Retry previewing audience" onRetry={() => void previewAudience()} />}
        {audienceExtensions.length > 0 && (
          <label>
            Audience configuration
            <select disabled={writeLocked} value={audienceExtensionId}
              onChange={(event) => setAudienceExtensionId(event.target.value)}>
              <option value="">None</option>
              {audienceExtensions.map((extension) =>
                <option key={extension.id} value={extension.id}>{extension.label}</option>)}
            </select>
          </label>
        )}
        {audienceExtension && AudiencePanel && (
          <AudiencePanel disabled={writeLocked}
            value={configFor(audienceConfigs, audienceExtension)}
            onChange={(value) => setAudienceConfigs((current) => ({
              ...current, [audienceExtension.id]: value,
            }))} />
        )}
        {channelExtensions.length > 0 && (
          <label>
            Channel configuration
            <select disabled={writeLocked} value={channelExtensionId}
              onChange={(event) => setChannelExtensionId(event.target.value)}>
              <option value="">None</option>
              {channelExtensions.map((extension) =>
                <option key={extension.id} value={extension.id}>{extension.label}</option>)}
            </select>
          </label>
        )}
        {channelExtension && ChannelPanel && (
          <ChannelPanel disabled={writeLocked}
            value={configFor(channelConfigs, channelExtension)}
            onChange={(value) => setChannelConfigs((current) => ({
              ...current, [channelExtension.id]: value,
            }))} />
        )}
        <button type="submit" disabled={writeLocked || !allowed}>
          {campaignId ? "Save campaign" : "Create campaign"}
        </button>
      </form>}
      {extensionError && <ErrorNotice error={extensionError} />}
      {operation.error && <ErrorNotice error={operation.error}
        retryLabel="Retry saving campaign" onRetry={() => void retry()} />}
    </main>
  );
}
