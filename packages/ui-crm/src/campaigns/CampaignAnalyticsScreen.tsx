import { useCallback, useEffect, useRef, useState } from "react";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import type { JsonValue } from "../core/provider-extensions.js";
import type { CrmUiError } from "../core/result.js";
import type { CampaignAnalyticsScreenProps } from "./adapter.js";
import type { CampaignStatsVm } from "./types.js";

const STAT_LABELS: Record<keyof CampaignStatsVm, string> = {
  total: "Total",
  pending: "Pending",
  scheduled: "Scheduled",
  inProgress: "In progress",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  optedOut: "Opted out",
  noAnswer: "No answer",
  voicemail: "Voicemail",
};
const STAT_KEYS = Object.keys(STAT_LABELS) as (keyof CampaignStatsVm)[];

export function CampaignAnalyticsScreen({
  adapter,
  campaignId,
  analyticsExtensions = [],
  className,
}: CampaignAnalyticsScreenProps) {
  const [stats, setStats] = useState<CampaignStatsVm | null>(null);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const token = ++request.current;
    setStats(null);
    setLoadError(null);
    const result = await safeAdapterCall(() => adapter.getStats(campaignId));
    if (token !== request.current) return;
    if (result.ok) setStats(result.data);
    else setLoadError(result.error);
  }, [adapter, campaignId]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  return (
    <main className={className}>
      <h1>Analytics</h1>
      {loadError && (
        <ErrorNotice
          error={loadError}
          retryLabel="Retry loading analytics"
          onRetry={() => void load()}
        />
      )}
      {!stats && !loadError && <p role="status">Loading analytics…</p>}
      {stats && (
        <dl>
          {STAT_KEYS.map((key) => (
            <div key={key}>
              <dt>{STAT_LABELS[key]}</dt>
              <dd>{stats[key]}</dd>
            </div>
          ))}
        </dl>
      )}
      {stats &&
        analyticsExtensions.map((extension) => {
          const data: Record<string, JsonValue> = { ...stats };
          return (
            <section key={extension.id} aria-label={extension.label}>
              <h2>{extension.label}</h2>
              <extension.Panel campaignId={campaignId} data={data} />
            </section>
          );
        })}
    </main>
  );
}
