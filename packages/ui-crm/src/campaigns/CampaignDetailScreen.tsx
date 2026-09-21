import { useCallback, useEffect, useRef, useState } from "react";
import type { CampaignStatus } from "@tindevelopers/schema-crm";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ConfirmDialog } from "../contacts/ConfirmDialog.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import type { CrmUiError } from "../core/result.js";
import type { CampaignDetailScreenProps } from "./adapter.js";
import type { CampaignDetailVm, CampaignLifecycleAction } from "./types.js";

const ACTIONS = {
  draft: ["schedule", "start", "cancel"],
  scheduled: ["start", "pause", "cancel"],
  running: ["pause", "complete", "cancel"],
  paused: ["resume", "cancel"],
  sent: ["complete"],
  completed: [],
  cancelled: [],
} as const satisfies Record<CampaignStatus, readonly CampaignLifecycleAction[]>;

const ACTION_LABELS: Record<CampaignLifecycleAction, string> = {
  schedule: "Schedule campaign",
  start: "Start campaign",
  pause: "Pause campaign",
  resume: "Resume campaign",
  complete: "Complete campaign",
  cancel: "Cancel campaign",
};

function actionsFor(status: string | null): readonly CampaignLifecycleAction[] {
  return status && Object.hasOwn(ACTIONS, status)
    ? ACTIONS[status as CampaignStatus]
    : [];
}

export function CampaignDetailScreen({
  adapter,
  capabilities,
  navigation,
  campaignId,
  className,
}: CampaignDetailScreenProps) {
  const [campaign, setCampaign] = useState<CampaignDetailVm | null>(null);
  const [error, setError] = useState<CrmUiError | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [writeLocked, setWriteLocked] = useState(false);
  const request = useRef(0);
  const writeLock = useRef(false);
  const visible = campaign?.id === campaignId ? campaign : null;
  const scope = JSON.stringify({
    campaignId,
    status: visible?.status ?? null,
    update: capabilities.update,
    remove: capabilities.remove,
  });
  const operation = useCrmOperation(scope);

  const load = useCallback(async () => {
    const token = ++request.current;
    setCampaign(null);
    setError(null);
    const result = await safeAdapterCall(() => adapter.getCampaign(campaignId));
    if (token !== request.current) return;
    if (!result.ok) setError(result.error);
    else if (!result.data) setError({
      code: "not_found", message: "Campaign not found.", retryable: false,
    });
    else setCampaign(result.data);
  }, [adapter, campaignId]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  useIsomorphicLayoutEffect(() => setConfirmingDelete(false), [
    campaignId, capabilities.remove,
  ]);

  async function runWrite(attempt: () => Promise<void>) {
    if (writeLock.current) return;
    writeLock.current = true;
    setWriteLocked(true);
    try {
      await attempt();
    } finally {
      writeLock.current = false;
      setWriteLocked(false);
    }
  }

  async function transition(action: CampaignLifecycleAction) {
    if (!visible || !capabilities.update || !actionsFor(visible.status).includes(action)) return;
    const target = visible.id;
    await runWrite(() => operation.start(
      () => adapter.transitionCampaign(target, action),
      setCampaign,
    ).then(() => undefined));
  }

  async function remove() {
    if (!visible || !capabilities.remove) return;
    const target = visible.id;
    setConfirmingDelete(false);
    await runWrite(() => operation.start(
      () => adapter.deleteCampaign(target),
      () => navigation.campaigns(),
    ).then(() => undefined));
  }

  return (
    <main className={className}>
      {error && <ErrorNotice error={error} retryLabel="Retry loading campaign"
        onRetry={() => void load()} />}
      {!visible && !error && <p role="status">Loading campaign…</p>}
      {visible && (
        <>
          <h1>{visible.name}</h1>
          <dl>
            <dt>Status</dt><dd>{visible.status ?? "Unknown"}</dd>
            <dt>Type</dt><dd>{visible.campaign_type}</dd>
            <dt>Description</dt><dd>{visible.description ?? "—"}</dd>
          </dl>
          {capabilities.update && (
            <button type="button" disabled={writeLocked}
              onClick={() => navigation.editCampaign(visible.id)}>Edit campaign</button>
          )}
          <button type="button" disabled={writeLocked}
            onClick={() => navigation.recipients(visible.id)}>Recipients</button>
          <button type="button" disabled={writeLocked}
            onClick={() => navigation.analytics(visible.id)}>Analytics</button>
          {capabilities.update && actionsFor(visible.status).map((action) => (
            <button key={action} type="button" disabled={writeLocked}
              onClick={() => void transition(action)}>
              {ACTION_LABELS[action]}
            </button>
          ))}
          {capabilities.remove && (
            <button type="button" disabled={writeLocked}
              onClick={() => setConfirmingDelete(true)}>Delete campaign</button>
          )}
          {confirmingDelete && capabilities.remove && (
            <ConfirmDialog titleId="delete-campaign-title"
              title={`Delete ${visible.name}?`} confirmLabel="Confirm delete"
              pending={writeLocked} onConfirm={() => void remove()}
              onCancel={() => setConfirmingDelete(false)} />
          )}
          {operation.error && (
            <ErrorNotice error={operation.error} retryLabel="Retry campaign operation"
              onRetry={() => void runWrite(operation.retry)} />
          )}
        </>
      )}
    </main>
  );
}
