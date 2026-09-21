import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CampaignType } from "@tindevelopers/schema-crm";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import type { JsonValue } from "../core/provider-extensions.js";
import type { CrmUiError, CrmUiResult } from "../core/result.js";
import type { CampaignWizardScreenProps } from "./adapter.js";
import type { AudiencePreviewVm, CampaignAudience, CampaignInput } from "./types.js";

const TYPES: CampaignType[] = ["voice", "sms", "whatsapp", "multi_channel", "email"];
const AUDIENCE_TYPES = ["all_contacts", "list", "tag", "contacts"] as const;

function emptyInput(): CampaignInput {
  return { name: "", campaign_type: "sms" };
}

function normalizeInput(input: CampaignInput): CampaignInput {
  return {
    ...input,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    message_template: input.message_template?.trim() || null,
  };
}

function audienceFor(type: (typeof AUDIENCE_TYPES)[number], listId: string, tag: string, contactIds: string): CampaignAudience {
  switch (type) {
    case "list":
      return { type: "list", listId };
    case "tag":
      return { type: "tag", tag };
    case "contacts":
      return {
        type: "contacts",
        contactIds: contactIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      };
    default:
      return { type: "all_contacts" };
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
  const mode: "create" | "edit" = campaignId ? "edit" : "create";
  const [draft, setDraft] = useState<CampaignInput>(emptyInput);
  const [audienceType, setAudienceType] = useState<(typeof AUDIENCE_TYPES)[number]>("all_contacts");
  const [listId, setListId] = useState("");
  const [tag, setTag] = useState("");
  const [contactIds, setContactIds] = useState("");
  const [preview, setPreview] = useState<AudiencePreviewVm | null>(null);
  const [activeChannelExtension, setActiveChannelExtension] = useState<string | null>(null);
  const [channelConfig, setChannelConfig] = useState<Record<string, JsonValue>>({});
  const [activeAudienceExtension, setActiveAudienceExtension] = useState<string | null>(null);
  const [audienceExtensionConfig, setAudienceExtensionConfig] = useState<Record<string, JsonValue>>({});
  const [extensionError, setExtensionError] = useState<CrmUiError | null>(null);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const request = useRef(0);
  const canEdit = mode === "create" ? capabilities.create : capabilities.update;
  const allowed = capabilities.create || capabilities.update;

  const audience = audienceFor(audienceType, listId, tag, contactIds);
  const previewOperation = useCrmOperation(JSON.stringify({ operation: "preview", audience }));
  const submitOperation = useCrmOperation(
    JSON.stringify({ operation: "submit", mode, campaignId, allowed: canEdit }),
  );

  const load = useCallback(async () => {
    if (mode !== "edit" || !campaignId) return;
    const token = ++request.current;
    setLoadError(null);
    const result = await safeAdapterCall(() => adapter.getCampaign(campaignId));
    if (token !== request.current) return;
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    if (!result.data) {
      setLoadError({ code: "not_found", message: "Campaign not found.", retryable: false });
      return;
    }
    const found = result.data;
    setDraft({
      name: found.name,
      campaign_type: found.campaign_type,
      description: found.description,
      schedule_start: found.schedule_start,
      schedule_end: found.schedule_end,
      calling_window_start: found.calling_window_start,
      calling_window_end: found.calling_window_end,
      calling_days: found.calling_days,
      timezone: found.timezone,
      message_template: found.message_template,
      settings: found.settings,
    });
  }, [adapter, campaignId, mode]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  useIsomorphicLayoutEffect(() => {
    setExtensionError(null);
  }, [activeChannelExtension, activeAudienceExtension]);

  async function runPreview() {
    if (activeAudienceExtension) return;
    await previewOperation.start(
      () => adapter.previewAudience(audience),
      (data) => setPreview(data),
    );
  }

  function selectChannelExtension(id: string | null) {
    setActiveChannelExtension(id);
  }

  function selectAudienceExtension(id: string | null) {
    setActiveAudienceExtension(id);
    setPreview(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !draft.name.trim()) return;

    let settings = draft.settings ?? null;
    if (activeChannelExtension) {
      const extension = channelExtensions.find((item) => item.id === activeChannelExtension);
      const value = channelConfig[activeChannelExtension] ?? null;
      const validation = extension?.validate(value);
      if (validation && !validation.ok) {
        setExtensionError(validation.error);
        return;
      }
      settings = { ...(settings ?? {}), [activeChannelExtension]: extension?.serialize(value) ?? null };
    }

    if (activeAudienceExtension) {
      const extension = audienceExtensions.find((item) => item.id === activeAudienceExtension);
      const value = audienceExtensionConfig[activeAudienceExtension] ?? null;
      const validation = extension?.validate(value);
      if (validation && !validation.ok) {
        setExtensionError(validation.error);
        return;
      }
    }

    const input = normalizeInput({ ...draft, settings });
    const resolvedAudience = activeAudienceExtension ? null : audience;

    if (mode === "create") {
      await submitOperation.start(
        async (): Promise<CrmUiResult<{ id: string }>> => {
          const created = await adapter.createCampaign(input);
          if (!created.ok || !resolvedAudience) return created;
          const audienceResult = await adapter.replaceAudience(created.data.id, resolvedAudience);
          if (!audienceResult.ok) return audienceResult;
          return created;
        },
        (data) => navigation.campaign(data.id),
      );
      return;
    }

    if (!campaignId) return;
    await submitOperation.start(
      async (): Promise<CrmUiResult<{ id: string }>> => {
        const updated = await adapter.updateCampaign(campaignId, input);
        if (!updated.ok || !resolvedAudience) {
          return updated.ok ? { ok: true, data: { id: campaignId } } : updated;
        }
        const audienceResult = await adapter.replaceAudience(campaignId, resolvedAudience);
        if (!audienceResult.ok) return audienceResult;
        return { ok: true, data: { id: campaignId } };
      },
      (data) => navigation.campaign(data.id),
    );
  }

  return (
    <main className={className}>
      <h1>{mode === "create" ? "New campaign" : "Edit campaign"}</h1>
      {loadError && (
        <ErrorNotice
          error={loadError}
          retryLabel="Retry loading campaign"
          onRetry={() => void load()}
        />
      )}
      {allowed && (
        <form onSubmit={submit}>
          <label>
            Campaign name
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <label>
            Campaign type
            <select
              value={draft.campaign_type}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  campaign_type: event.target.value as CampaignType,
                }))
              }
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <textarea
              value={draft.description ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value || null }))
              }
            />
          </label>
          <label>
            Message template
            <textarea
              value={draft.message_template ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, message_template: event.target.value || null }))
              }
            />
          </label>

          <fieldset>
            <legend>Audience</legend>
            {!activeAudienceExtension && (
              <>
                <label>
                  Audience source
                  <select
                    value={audienceType}
                    onChange={(event) => {
                      setAudienceType(event.target.value as (typeof AUDIENCE_TYPES)[number]);
                      setPreview(null);
                    }}
                  >
                    {AUDIENCE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                {audienceType === "list" && (
                  <label>
                    List id
                    <input value={listId} onChange={(event) => setListId(event.target.value)} />
                  </label>
                )}
                {audienceType === "tag" && (
                  <label>
                    Tag
                    <input value={tag} onChange={(event) => setTag(event.target.value)} />
                  </label>
                )}
                {audienceType === "contacts" && (
                  <label>
                    Contact ids
                    <input
                      value={contactIds}
                      onChange={(event) => setContactIds(event.target.value)}
                      placeholder="Comma-separated contact ids"
                    />
                  </label>
                )}
                <button type="button" disabled={previewOperation.pending} onClick={() => void runPreview()}>
                  Preview audience
                </button>
                {previewOperation.error && (
                  <ErrorNotice
                    error={previewOperation.error}
                    retryLabel="Retry previewing audience"
                    onRetry={previewOperation.retry}
                  />
                )}
                {preview && <p>{preview.total} contacts match this audience.</p>}
              </>
            )}

            {audienceExtensions.length > 0 && (
              <div>
                <label>
                  Provider audience source
                  <select
                    value={activeAudienceExtension ?? ""}
                    onChange={(event) => selectAudienceExtension(event.target.value || null)}
                  >
                    <option value="">Canonical contacts</option>
                    {audienceExtensions.map((extension) => (
                      <option key={extension.id} value={extension.id}>
                        {extension.label}
                      </option>
                    ))}
                  </select>
                </label>
                {audienceExtensions
                  .filter((extension) => extension.id === activeAudienceExtension)
                  .map((extension) => (
                    <extension.Panel
                      key={extension.id}
                      value={audienceExtensionConfig[extension.id] ?? null}
                      disabled={!canEdit}
                      onChange={(value) =>
                        setAudienceExtensionConfig((current) => ({ ...current, [extension.id]: value }))
                      }
                    />
                  ))}
              </div>
            )}
          </fieldset>

          {channelExtensions.length > 0 && (
            <fieldset>
              <legend>Channel</legend>
              <label>
                Provider channel
                <select
                  value={activeChannelExtension ?? ""}
                  onChange={(event) => selectChannelExtension(event.target.value || null)}
                >
                  <option value="">None</option>
                  {channelExtensions.map((extension) => (
                    <option key={extension.id} value={extension.id}>
                      {extension.label}
                    </option>
                  ))}
                </select>
              </label>
              {channelExtensions
                .filter((extension) => extension.id === activeChannelExtension)
                .map((extension) => (
                  <extension.Panel
                    key={extension.id}
                    value={channelConfig[extension.id] ?? null}
                    disabled={!canEdit}
                    onChange={(value) =>
                      setChannelConfig((current) => ({ ...current, [extension.id]: value }))
                    }
                  />
                ))}
            </fieldset>
          )}

          {extensionError && <ErrorNotice error={extensionError} />}

          <button type="submit" disabled={!canEdit || submitOperation.pending}>
            {mode === "create" ? "Create campaign" : "Save campaign"}
          </button>
          {submitOperation.error && (
            <ErrorNotice
              error={submitOperation.error}
              retryLabel={mode === "create" ? "Retry creating campaign" : "Retry saving campaign"}
              onRetry={submitOperation.retry}
            />
          )}
        </form>
      )}
    </main>
  );
}
