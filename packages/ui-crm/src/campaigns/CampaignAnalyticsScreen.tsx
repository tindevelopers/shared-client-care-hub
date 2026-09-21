import { useCallback, useEffect, useRef, useState } from "react";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import type { JsonValue } from "../core/provider-extensions.js";
import type { CrmUiError } from "../core/result.js";
import type { CampaignAnalyticsScreenProps } from "./adapter.js";
import type { CampaignStatsVm } from "./types.js";

const LABELS: Record<keyof CampaignStatsVm, string> = {
  total: "Total", pending: "Pending", scheduled: "Scheduled",
  inProgress: "In progress", completed: "Completed", failed: "Failed",
  skipped: "Skipped", optedOut: "Opted out", noAnswer: "No answer",
  voicemail: "Voicemail",
};

export function CampaignAnalyticsScreen({
  adapter,
  campaignId,
  analyticsExtensions = [],
  className,
}: CampaignAnalyticsScreenProps) {
  const [stats, setStats] = useState<CampaignStatsVm | null>(null);
  const [error, setError] = useState<CrmUiError | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const token = ++request.current;
    setStats(null);
    setError(null);
    const result = await safeAdapterCall(() => adapter.getStats(campaignId));
    if (token !== request.current) return;
    if (result.ok) setStats(result.data);
    else setError(result.error);
  }, [adapter, campaignId]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  return (
    <main className={className}>
      <h1>Campaign analytics</h1>
      {!stats && !error && <p role="status">Loading analytics…</p>}
      {error && <ErrorNotice error={error} retryLabel="Retry loading analytics"
        onRetry={() => void load()} />}
      {stats && (
        <>
          <table aria-label="Campaign analytics">
            <thead><tr><th scope="col">Metric</th><th scope="col">Count</th></tr></thead>
            <tbody>{(Object.keys(LABELS) as (keyof CampaignStatsVm)[]).map((key) => (
              <tr key={key}><th scope="row">{LABELS[key]}</th><td>{stats[key]}</td></tr>
            ))}</tbody>
          </table>
          {analyticsExtensions.map(({ id, label, Panel }) => (
            <section key={id} aria-label={label}>
              <Panel campaignId={campaignId} data={stats as unknown as JsonValue} />
            </section>
          ))}
        </>
      )}
    </main>
  );
}
