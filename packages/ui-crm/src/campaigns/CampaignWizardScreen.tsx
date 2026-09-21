import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CampaignType } from "@tindevelopers/schema-crm";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import { ExtensionPanelBoundary } from "../core/ExtensionPanelBoundary.js";
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

function configFor<TConfig extends JsonValue>(
  configs: Partial<Record<string, TConfig>>,
  extension: AudienceSourceExtension<TConfig> | CampaignChannelExtension<TConfig>,
): TConfig {
  if (Object.hasOwn(configs, extension.id)) return configs[extension.id] as TConfig;
  return (extension.initialValue ?? null) as TConfig;
}

function extensionValue<TConfig extends JsonValue>(
  extension: AudienceSourceExtension<TConfig> | CampaignChannelExtension<TConfig>,
  value: TConfig,
): CrmUiResult<JsonValue> {
  try {
    const validated = extension.validate(value);
    if (!validated.ok) return validated;
    return { ok: true, data: extension.serialize(value) };
  } catch {
    return { ok: false, error: EXTENSION_ERROR };
  }
}

export function CampaignWizardScreen<
  TAudienceConfig extends JsonValue = JsonValue,
  TChannelConfig extends JsonValue = JsonValue,
>({
  adapter,
  capabilities,
  navigation,
  campaignId,
  audienceExtensions = [],
  channelExtensions = [],
  className,
}: CampaignWizardScreenProps<TAudienceConfig, TChannelConfig>) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CampaignType>("email");
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [callingWindowStart, setCallingWindowStart] = useState("");
  const [callingWindowEnd, setCallingWindowEnd] = useState("");
  const [callingDays, setCallingDays] = useState("");
  const [timezone, setTimezone] = useState("");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [audienceType, setAudienceType] = useState<AudienceType>("all_contacts");
  const [listId, setListId] = useState("");
  const [tag, setTag] = useState("");
  const [contactIds, setContactIds] = useState("");
  const [audienceExtensionId, setAudienceExtensionId] = useState("");
  const [channelExtensionId, setChannelExtensionId] = useState("");
  const [audienceConfigs, setAudienceConfigs] =
    useState<Partial<Record<string, TAudienceConfig>>>({});
  const [channelConfigs, setChannelConfigs] =
    useState<Partial<Record<string, TChannelConfig>>>({});
  const [audienceDirty, setAudienceDirty] = useState(!campaignId);
  const [extensionsDirty, setExtensionsDirty] = useState(false);
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
  const audienceConfig = audienceExtension
    ? configFor(audienceConfigs, audienceExtension)
    : null;
  const channelConfig = channelExtension
    ? configFor(channelConfigs, channelExtension)
    : null;
  const audienceReady =
    (audience.type !== "list" || Boolean(audience.listId)) &&
    (audience.type !== "tag" || Boolean(audience.tag)) &&
    (audience.type !== "contacts" || audience.contactIds.length > 0);

  const scope = JSON.stringify({
    campaignId: campaignId ?? null,
    allowed: campaignId ? capabilities.update : capabilities.create,
    name, description, type, scheduleStart, scheduleEnd,
    callingWindowStart, callingWindowEnd, callingDays, timezone, messageTemplate,
    audience: audienceDirty ? audience : null,
    audienceExtensionId, channelExtensionId,
    audienceConfig, channelConfig, extensionsDirty,
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
      setScheduleStart(result.data.schedule_start ?? "");
      setScheduleEnd(result.data.schedule_end ?? "");
      setCallingWindowStart(result.data.calling_window_start ?? "");
      setCallingWindowEnd(result.data.calling_window_end ?? "");
      setCallingDays(result.data.calling_days?.join(", ") ?? "");
      setTimezone(result.data.timezone ?? "");
      setMessageTemplate(result.data.message_template ?? "");
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
    setAudienceDirty(!campaignId);
    setExtensionsDirty(false);
    setAudienceExtensionId("");
    setChannelExtensionId("");
    setAudienceConfigs({});
    setChannelConfigs({});
    setExtensionError(null);
  }, [campaignId]);
  useIsomorphicLayoutEffect(() => {
    setExtensionError(null);
  }, [
    campaignId,
    audienceExtensionId,
    channelExtensionId,
    JSON.stringify(audienceConfig),
    JSON.stringify(channelConfig),
  ]);
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
    if (audienceDirty && !audienceReady) return;

    setExtensionError(null);
    const settings: Record<string, JsonValue> = {};
    if (extensionsDirty && audienceExtension) {
      const value = extensionValue(
        audienceExtension,
        audienceConfig as TAudienceConfig,
      );
      if (!value.ok) {
        setExtensionError(value.error);
        return;
      }
      settings.audienceExtension = { id: audienceExtension.id, config: value.data };
    }
    if (extensionsDirty && channelExtension) {
      const value = extensionValue(
        channelExtension,
        channelConfig as TChannelConfig,
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
      schedule_start: scheduleStart.trim() || null,
      schedule_end: scheduleEnd.trim() || null,
      calling_window_start: callingWindowStart.trim() || null,
      calling_window_end: callingWindowEnd.trim() || null,
      calling_days: callingDays.trim()
        ? callingDays.split(",").map((day) => Number(day.trim()))
          .filter((day) => Number.isInteger(day))
        : null,
      timezone: timezone.trim() || null,
      message_template: messageTemplate.trim() || null,
      ...(extensionsDirty
        ? { settings: Object.keys(settings).length ? settings : null }
        : {}),
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
      if (audienceDirty) {
        const audienceResult = await adapter.replaceAudience(targetId, selectedAudience);
        if (!audienceResult.ok) return audienceResult;
      }
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
        <label>
          Schedule start
          <input disabled={writeLocked} value={scheduleStart}
            onChange={(event) => setScheduleStart(event.target.value)} />
        </label>
        <label>
          Schedule end
          <input disabled={writeLocked} value={scheduleEnd}
            onChange={(event) => setScheduleEnd(event.target.value)} />
        </label>
        <label>
          Calling window start
          <input disabled={writeLocked} value={callingWindowStart}
            onChange={(event) => setCallingWindowStart(event.target.value)} />
        </label>
        <label>
          Calling window end
          <input disabled={writeLocked} value={callingWindowEnd}
            onChange={(event) => setCallingWindowEnd(event.target.value)} />
        </label>
        <label>
          Calling days
          <input disabled={writeLocked} value={callingDays}
            onChange={(event) => setCallingDays(event.target.value)} />
        </label>
        <label>
          Timezone
          <input disabled={writeLocked} value={timezone}
            onChange={(event) => setTimezone(event.target.value)} />
        </label>
        <label>
          Message template
          <textarea disabled={writeLocked} value={messageTemplate}
            onChange={(event) => setMessageTemplate(event.target.value)} />
        </label>
        <fieldset disabled={writeLocked}>
          <legend>Audience</legend>
          <label>
            Audience type
            <select value={audienceType}
              onChange={(event) => {
                setAudienceType(event.target.value as AudienceType);
                setAudienceDirty(true);
              }}>
              <option value="all_contacts">All contacts</option>
              <option value="list">List</option>
              <option value="tag">Tag</option>
              <option value="contacts">Selected contacts</option>
            </select>
          </label>
          {audienceType === "list" && <label>Audience list
            <input value={listId} onChange={(event) => {
              setListId(event.target.value);
              setAudienceDirty(true);
            }} />
          </label>}
          {audienceType === "tag" && <label>Audience tag
            <input value={tag} onChange={(event) => {
              setTag(event.target.value);
              setAudienceDirty(true);
            }} />
          </label>}
          {audienceType === "contacts" && <label>Contact IDs
            <input value={contactIds} onChange={(event) => {
              setContactIds(event.target.value);
              setAudienceDirty(true);
            }} />
          </label>}
        </fieldset>
        <button type="button" disabled={writeLocked || !audienceReady}
          onClick={() => void previewAudience()}>
          Preview audience
        </button>
        {preview && (
          <section aria-label="Audience preview">
            <p role="status">{preview.total} contacts</p>
            {preview.sample.length > 0 && (
              <table>
                <thead><tr>
                  <th scope="col">Name</th><th scope="col">Email</th><th scope="col">Phone</th>
                </tr></thead>
                <tbody>{preview.sample.map((contact) => (
                  <tr key={contact.id}>
                    <th scope="row">{contact.first_name} {contact.last_name}</th>
                    <td>{contact.email ?? "—"}</td>
                    <td>{contact.phone ?? contact.mobile ?? "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>
        )}
        {previewError && <ErrorNotice error={previewError}
          retryLabel="Retry previewing audience" onRetry={() => void previewAudience()} />}
        {audienceExtensions.length > 0 && (
          <label>
            Audience configuration
            <select disabled={writeLocked} value={audienceExtensionId}
              onChange={(event) => {
                setAudienceExtensionId(event.target.value);
                setExtensionsDirty(true);
              }}>
              <option value="">None</option>
              {audienceExtensions.map((extension) =>
                <option key={extension.id} value={extension.id}>{extension.label}</option>)}
            </select>
          </label>
        )}
        {audienceExtension && AudiencePanel && (
          <ExtensionPanelBoundary
            key={`${campaignId ?? "new"}:audience:${audienceExtension.id}`}
            resetKey={JSON.stringify(audienceConfig)}
          >
            <AudiencePanel disabled={writeLocked}
              value={audienceConfig as TAudienceConfig}
              onChange={(value) => {
                if (writeLock.current) return;
                setAudienceConfigs((current) => ({
                  ...current, [audienceExtension.id]: value,
                }));
                setExtensionsDirty(true);
              }} />
          </ExtensionPanelBoundary>
        )}
        {channelExtensions.length > 0 && (
          <label>
            Channel configuration
            <select disabled={writeLocked} value={channelExtensionId}
              onChange={(event) => {
                setChannelExtensionId(event.target.value);
                setExtensionsDirty(true);
              }}>
              <option value="">None</option>
              {channelExtensions.map((extension) =>
                <option key={extension.id} value={extension.id}>{extension.label}</option>)}
            </select>
          </label>
        )}
        {channelExtension && ChannelPanel && (
          <ExtensionPanelBoundary
            key={`${campaignId ?? "new"}:channel:${channelExtension.id}`}
            resetKey={JSON.stringify(channelConfig)}
          >
            <ChannelPanel disabled={writeLocked}
              value={channelConfig as TChannelConfig}
              onChange={(value) => {
                if (writeLock.current) return;
                setChannelConfigs((current) => ({
                  ...current, [channelExtension.id]: value,
                }));
                setExtensionsDirty(true);
              }} />
          </ExtensionPanelBoundary>
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
