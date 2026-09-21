import { useCallback, useEffect, useRef, useState } from "react";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ConfirmDialog } from "../contacts/ConfirmDialog.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import type { CrmUiError } from "../core/result.js";
import type { CampaignDetailScreenProps } from "./adapter.js";
import { CAMPAIGN_LIFECYCLE_LABELS, CAMPAIGN_TRANSITIONS } from "./types.js";
import type { CampaignDetailVm, CampaignLifecycleAction } from "./types.js";

export function CampaignDetailScreen({
  adapter,
  capabilities,
  navigation,
  campaignId,
  className,
}: CampaignDetailScreenProps) {
  const [campaign, setCampaign] = useState<CampaignDetailVm | null>(null);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const request = useRef(0);
  const visible = campaign && campaign.id === campaignId ? campaign : null;
  const deleteScope = `delete:${campaignId}:${capabilities.remove}`;
  const deleteOperation = useCrmOperation(deleteScope);
  const transitionScope = `transition:${campaignId}:${visible?.status ?? ""}:${capabilities.update}`;
  const transitionOperation = useCrmOperation(transitionScope);

  const load = useCallback(async () => {
    const token = ++request.current;
    setCampaign(null);
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
    setCampaign(result.data);
  }, [adapter, campaignId]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  useIsomorphicLayoutEffect(() => {
    setConfirmingDelete(false);
  }, [deleteScope]);

  async function remove() {
    if (!visible) return;
    const targetId = visible.id;
    await deleteOperation.start(() => adapter.deleteCampaign(targetId), navigation.campaigns);
    setConfirmingDelete(false);
  }

  async function transition(action: CampaignLifecycleAction) {
    if (!visible || !capabilities.update) return;
    const targetId = visible.id;
    await transitionOperation.start(
      () => adapter.transitionCampaign(targetId, action),
      (updated) => setCampaign(updated),
    );
  }

  const allowedActions = visible ? CAMPAIGN_TRANSITIONS[visible.status ?? "draft"] : [];

  return (
    <main className={className}>
      {loadError && (
        <ErrorNotice
          error={loadError}
          retryLabel="Retry loading campaign"
          onRetry={() => void load()}
        />
      )}
      {!visible && !loadError && <p role="status">Loading campaign…</p>}
      {visible && (
        <>
          <header>
            <h1>{visible.name}</h1>
            <p>{visible.status ?? "draft"}</p>
            {capabilities.update && (
              <button type="button" onClick={() => navigation.editCampaign(visible.id)}>
                Edit campaign
              </button>
            )}
            {capabilities.remove && (
              <button
                type="button"
                disabled={deleteOperation.pending}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete campaign
              </button>
            )}
            <button type="button" onClick={() => navigation.recipients(visible.id)}>
              View recipients
            </button>
            <button type="button" onClick={() => navigation.analytics(visible.id)}>
              View analytics
            </button>
          </header>

          {capabilities.update && allowedActions.length > 0 && (
            <section aria-labelledby="campaign-lifecycle-title">
              <h2 id="campaign-lifecycle-title">Lifecycle</h2>
              {allowedActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={transitionOperation.pending}
                  onClick={() => void transition(action)}
                >
                  {CAMPAIGN_LIFECYCLE_LABELS[action]}
                </button>
              ))}
              {transitionOperation.error && (
                <ErrorNotice
                  error={transitionOperation.error}
                  retryLabel="Retry lifecycle action"
                  onRetry={transitionOperation.retry}
                />
              )}
            </section>
          )}

          {capabilities.remove && confirmingDelete && (
            <ConfirmDialog
              titleId="delete-campaign-title"
              title={`Delete ${visible.name}?`}
              confirmLabel="Confirm delete"
              pending={deleteOperation.pending}
              onConfirm={() => void remove()}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}
          {capabilities.remove && deleteOperation.error && (
            <ErrorNotice
              error={deleteOperation.error}
              retryLabel="Retry deleting campaign"
              onRetry={deleteOperation.retry}
            />
          )}

          <dl>
            <dt>Type</dt>
            <dd>{visible.campaign_type}</dd>
            <dt>Description</dt>
            <dd>{visible.description ?? "—"}</dd>
            <dt>Schedule start</dt>
            <dd>{visible.schedule_start ?? "—"}</dd>
            <dt>Schedule end</dt>
            <dd>{visible.schedule_end ?? "—"}</dd>
            <dt>Provider</dt>
            <dd>{visible.provider ?? "—"}</dd>
          </dl>
        </>
      )}
    </main>
  );
}
