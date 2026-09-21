import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { CampaignType } from "@tindevelopers/schema-crm";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import { ExtensionPanelBoundary } from "../core/ExtensionPanelBoundary.js";
import type {
  AudienceSourceExtensionDefinition,
  CampaignChannelExtensionDefinition,
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
type FieldName =
  | "scheduleStart"
  | "scheduleEnd"
  | "callingWindowStart"
  | "callingWindowEnd"
  | "callingDays"
  | "timezone";
type FieldErrors = Partial<Record<FieldName, string>>;

function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function validTimezone(value: string): boolean {
  if (value !== "UTC" && !/^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function parseCallingDays(value: string): number[] | null {
  if (!value.trim()) return null;
  const tokens = value.split(",").map((token) => token.trim());
  if (
    tokens.some((token) => !/^\d+$/.test(token)) ||
    tokens.some((token) => Number(token) < 0 || Number(token) > 6)
  ) return null;
  const days = tokens.map(Number);
  return new Set(days).size === days.length ? days : null;
}

function configFor(
  configs: Partial<Record<string, JsonValue>>,
  extension: AudienceSourceExtensionDefinition | CampaignChannelExtensionDefinition,
): JsonValue {
  if (Object.hasOwn(configs, extension.id)) return configs[extension.id] as JsonValue;
  return extension.initialValue;
}

function extensionValue(
  extension: AudienceSourceExtensionDefinition | CampaignChannelExtensionDefinition,
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
  const owner = campaignId ? `edit:${campaignId}` : "create";
  const [committedOwner, setCommittedOwner] = useState(owner);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CampaignType>("email");
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [originalScheduleStart, setOriginalScheduleStart] = useState<string | null>(null);
  const [originalScheduleEnd, setOriginalScheduleEnd] = useState<string | null>(null);
  const [scheduleStartDirty, setScheduleStartDirty] = useState(false);
  const [scheduleEndDirty, setScheduleEndDirty] = useState(false);
  const [callingWindowStart, setCallingWindowStart] = useState("");
  const [callingWindowEnd, setCallingWindowEnd] = useState("");
  const [originalCallingWindowStart, setOriginalCallingWindowStart] =
    useState<string | null>(null);
  const [originalCallingWindowEnd, setOriginalCallingWindowEnd] =
    useState<string | null>(null);
  const [callingWindowStartDirty, setCallingWindowStartDirty] = useState(false);
  const [callingWindowEndDirty, setCallingWindowEndDirty] = useState(false);
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
    useState<Partial<Record<string, JsonValue>>>({});
  const [channelConfigs, setChannelConfigs] =
    useState<Partial<Record<string, JsonValue>>>({});
  const [audienceDirty, setAudienceDirty] = useState(!campaignId);
  const [extensionsDirty, setExtensionsDirty] = useState(false);
  const [loadedCampaignId, setLoadedCampaignId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const [extensionError, setExtensionError] = useState<CrmUiError | null>(null);
  const [preview, setPreview] = useState<AudiencePreviewVm | null>(null);
  const [previewError, setPreviewError] = useState<CrmUiError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [writeLocked, setWriteLocked] = useState(false);
  const request = useRef(0);
  const previewRequest = useRef(0);
  const writeLock = useRef(false);
  const writeGeneration = useRef(0);
  const allowed = campaignId ? capabilities.update : capabilities.create;
  const ready =
    committedOwner === owner &&
    (!campaignId || loadedCampaignId === campaignId);
  const audienceExtension = audienceExtensions.find(({ id }) => id === audienceExtensionId);
  const channelExtension = channelExtensions.find(({ id }) => id === channelExtensionId);
  const audiencePanelToken = useMemo(
    () => audienceExtension ? {} : null,
    [owner, audienceExtension],
  );
  const channelPanelToken = useMemo(
    () => channelExtension ? {} : null,
    [owner, channelExtension],
  );
  const audiencePanelOwner = useRef({
    owner,
    definition: audienceExtension,
    token: audiencePanelToken,
  });
  const channelPanelOwner = useRef({
    owner,
    definition: channelExtension,
    token: channelPanelToken,
  });

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
    owner,
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
      setScheduleStart(toDateTimeLocal(result.data.schedule_start));
      setScheduleEnd(toDateTimeLocal(result.data.schedule_end));
      setOriginalScheduleStart(result.data.schedule_start);
      setOriginalScheduleEnd(result.data.schedule_end);
      setScheduleStartDirty(false);
      setScheduleEndDirty(false);
      setCallingWindowStart(result.data.calling_window_start?.slice(0, 5) ?? "");
      setCallingWindowEnd(result.data.calling_window_end?.slice(0, 5) ?? "");
      setOriginalCallingWindowStart(result.data.calling_window_start);
      setOriginalCallingWindowEnd(result.data.calling_window_end);
      setCallingWindowStartDirty(false);
      setCallingWindowEndDirty(false);
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
    audiencePanelOwner.current = {
      owner,
      definition: audienceExtension,
      token: audiencePanelToken,
    };
    channelPanelOwner.current = {
      owner,
      definition: channelExtension,
      token: channelPanelToken,
    };
  }, [
    owner,
    audienceExtension,
    audiencePanelToken,
    channelExtension,
    channelPanelToken,
  ]);
  useIsomorphicLayoutEffect(() => {
    writeGeneration.current += 1;
    writeLock.current = false;
    setWriteLocked(false);
    setCommittedOwner(owner);
    setName("");
    setDescription("");
    setType("email");
    setScheduleStart("");
    setScheduleEnd("");
    setOriginalScheduleStart(null);
    setOriginalScheduleEnd(null);
    setScheduleStartDirty(false);
    setScheduleEndDirty(false);
    setCallingWindowStart("");
    setCallingWindowEnd("");
    setOriginalCallingWindowStart(null);
    setOriginalCallingWindowEnd(null);
    setCallingWindowStartDirty(false);
    setCallingWindowEndDirty(false);
    setCallingDays("");
    setTimezone("");
    setMessageTemplate("");
    setAudienceType("all_contacts");
    setListId("");
    setTag("");
    setContactIds("");
    setAudienceDirty(!campaignId);
    setExtensionsDirty(false);
    setAudienceExtensionId("");
    setChannelExtensionId("");
    setAudienceConfigs({});
    setChannelConfigs({});
    setLoadedCampaignId(null);
    setLoadError(null);
    setExtensionError(null);
    setFieldErrors({});
    previewRequest.current += 1;
    setPreview(null);
    setPreviewError(null);
  }, [owner, campaignId]);
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

    const errors: FieldErrors = {};
    const startDate = scheduleStart ? new Date(scheduleStart) : null;
    const endDate = scheduleEnd ? new Date(scheduleEnd) : null;
    if (startDate && Number.isNaN(startDate.getTime())) {
      errors.scheduleStart = "Enter a valid schedule start.";
    }
    if (endDate && Number.isNaN(endDate.getTime())) {
      errors.scheduleEnd = "Enter a valid schedule end.";
    }
    if (
      startDate && endDate &&
      !Number.isNaN(startDate.getTime()) &&
      !Number.isNaN(endDate.getTime()) &&
      startDate > endDate
    ) {
      errors.scheduleEnd = "Schedule end must be after schedule start.";
    }
    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (callingWindowStart && !timePattern.test(callingWindowStart)) {
      errors.callingWindowStart = "Enter a valid calling window start.";
    }
    if (callingWindowEnd && !timePattern.test(callingWindowEnd)) {
      errors.callingWindowEnd = "Enter a valid calling window end.";
    }
    if (
      callingWindowStart &&
      callingWindowEnd &&
      timePattern.test(callingWindowStart) &&
      timePattern.test(callingWindowEnd) &&
      callingWindowStart >= callingWindowEnd
    ) {
      errors.callingWindowEnd = "Calling window end must be after its start.";
    }
    const parsedDays = parseCallingDays(callingDays);
    if (callingDays.trim() && !parsedDays) {
      errors.callingDays = "Calling days must be unique integers from 0 through 6.";
    }
    if (timezone.trim() && !validTimezone(timezone.trim())) {
      errors.timezone = "Enter a valid IANA timezone.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setExtensionError(null);
    const settings: Record<string, JsonValue> = {};
    if (extensionsDirty && audienceExtension) {
      const value = extensionValue(
        audienceExtension,
        audienceConfig,
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
        channelConfig,
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
      schedule_start: campaignId && !scheduleStartDirty
        ? originalScheduleStart
        : startDate?.toISOString() ?? null,
      schedule_end: campaignId && !scheduleEndDirty
        ? originalScheduleEnd
        : endDate?.toISOString() ?? null,
      calling_window_start: campaignId && !callingWindowStartDirty
        ? originalCallingWindowStart
        : callingWindowStart.trim() || null,
      calling_window_end: campaignId && !callingWindowEndDirty
        ? originalCallingWindowEnd
        : callingWindowEnd.trim() || null,
      calling_days: parsedDays,
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

    const generation = writeGeneration.current;
    writeLock.current = true;
    setWriteLocked(true);
    try {
      await operation.start(save, ({ id }) => navigation.campaign(id));
    } finally {
      if (writeGeneration.current === generation) {
        writeLock.current = false;
        setWriteLocked(false);
      }
    }
  }

  async function retry() {
    if (writeLock.current) return;
    const generation = writeGeneration.current;
    writeLock.current = true;
    setWriteLocked(true);
    try {
      await operation.retry();
    } finally {
      if (writeGeneration.current === generation) {
        writeLock.current = false;
        setWriteLocked(false);
      }
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
          <input type="datetime-local" disabled={writeLocked} value={scheduleStart}
            aria-invalid={Boolean(fieldErrors.scheduleStart)}
            aria-describedby={fieldErrors.scheduleStart ? "schedule-start-error" : undefined}
            onChange={(event) => {
              setScheduleStart(event.target.value);
              setScheduleStartDirty(true);
            }} />
        </label>
        {fieldErrors.scheduleStart &&
          <p id="schedule-start-error" role="alert">{fieldErrors.scheduleStart}</p>}
        <label>
          Schedule end
          <input type="datetime-local" disabled={writeLocked} value={scheduleEnd}
            aria-invalid={Boolean(fieldErrors.scheduleEnd)}
            aria-describedby={fieldErrors.scheduleEnd ? "schedule-end-error" : undefined}
            onChange={(event) => {
              setScheduleEnd(event.target.value);
              setScheduleEndDirty(true);
            }} />
        </label>
        {fieldErrors.scheduleEnd &&
          <p id="schedule-end-error" role="alert">{fieldErrors.scheduleEnd}</p>}
        <label>
          Calling window start
          <input type="time" disabled={writeLocked} value={callingWindowStart}
            aria-invalid={Boolean(fieldErrors.callingWindowStart)}
            aria-describedby={
              fieldErrors.callingWindowStart ? "calling-window-start-error" : undefined
            }
            onChange={(event) => {
              setCallingWindowStart(event.target.value);
              setCallingWindowStartDirty(true);
            }} />
        </label>
        {fieldErrors.callingWindowStart &&
          <p id="calling-window-start-error" role="alert">
            {fieldErrors.callingWindowStart}
          </p>}
        <label>
          Calling window end
          <input type="time" disabled={writeLocked} value={callingWindowEnd}
            aria-invalid={Boolean(fieldErrors.callingWindowEnd)}
            aria-describedby={
              fieldErrors.callingWindowEnd ? "calling-window-end-error" : undefined
            }
            onChange={(event) => {
              setCallingWindowEnd(event.target.value);
              setCallingWindowEndDirty(true);
            }} />
        </label>
        {fieldErrors.callingWindowEnd &&
          <p id="calling-window-end-error" role="alert">{fieldErrors.callingWindowEnd}</p>}
        <label>
          Calling days
          <input disabled={writeLocked} value={callingDays}
            aria-invalid={Boolean(fieldErrors.callingDays)}
            aria-describedby={fieldErrors.callingDays ? "calling-days-error" : undefined}
            onChange={(event) => setCallingDays(event.target.value)} />
        </label>
        {fieldErrors.callingDays &&
          <p id="calling-days-error" role="alert">{fieldErrors.callingDays}</p>}
        <label>
          Timezone
          <input disabled={writeLocked} value={timezone}
            aria-invalid={Boolean(fieldErrors.timezone)}
            aria-describedby={fieldErrors.timezone ? "timezone-error" : undefined}
            onChange={(event) => setTimezone(event.target.value)} />
        </label>
        {fieldErrors.timezone &&
          <p id="timezone-error" role="alert">{fieldErrors.timezone}</p>}
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
            implementation={audienceExtension}
            resetKey={JSON.stringify(audienceConfig)}
          >
            <AudiencePanel disabled={writeLocked}
              value={audienceConfig}
              onChange={(value) => {
                if (
                  writeLock.current ||
                  audiencePanelOwner.current.owner !== owner ||
                  audiencePanelOwner.current.definition !== audienceExtension ||
                  audiencePanelOwner.current.token !== audiencePanelToken
                ) return;
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
            implementation={channelExtension}
            resetKey={JSON.stringify(channelConfig)}
          >
            <ChannelPanel disabled={writeLocked}
              value={channelConfig}
              onChange={(value) => {
                if (
                  writeLock.current ||
                  channelPanelOwner.current.owner !== owner ||
                  channelPanelOwner.current.definition !== channelExtension ||
                  channelPanelOwner.current.token !== channelPanelToken
                ) return;
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
