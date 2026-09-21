import { useCallback, useEffect, useRef, useState } from "react";
import type { CampaignRecipientStatus } from "@tindevelopers/schema-crm";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import type { CrmUiError } from "../core/result.js";
import type { CampaignRecipientsScreenProps } from "./adapter.js";
import type { CampaignRecipientPage, RecipientQuery } from "./types.js";

const PAGE_SIZE = 20;
const STATUSES: CampaignRecipientStatus[] = [
  "pending",
  "scheduled",
  "in_progress",
  "completed",
  "failed",
  "skipped",
  "opted_out",
  "no_answer",
  "voicemail",
];

export function CampaignRecipientsScreen({
  adapter,
  campaignId,
  className,
}: CampaignRecipientsScreenProps) {
  const [page, setPage] = useState<CampaignRecipientPage | null>(null);
  const [query, setQuery] = useState<RecipientQuery>({ limit: PAGE_SIZE, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const token = ++request.current;
    setLoading(true);
    setLoadError(null);
    const result = await safeAdapterCall(() => adapter.listRecipients(campaignId, query));
    if (token !== request.current) return;
    setLoading(false);
    if (result.ok) setPage(result.data);
    else {
      setPage(null);
      setLoadError(result.error);
    }
  }, [adapter, campaignId, query]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  return (
    <main className={className}>
      <h1>Recipients</h1>
      <label>
        Status
        <select
          value={query.status ?? ""}
          onChange={(event) =>
            setQuery((current) => ({
              ...current,
              status: (event.target.value || undefined) as CampaignRecipientStatus | undefined,
              offset: 0,
            }))
          }
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>

      {loading && <p role="status">Loading recipients…</p>}
      {loadError && (
        <ErrorNotice
          error={loadError}
          retryLabel="Retry loading recipients"
          onRetry={() => void load()}
        />
      )}
      {!loading && !loadError && page?.items.length === 0 && <p>No recipients found.</p>}
      {!loading && !loadError && page && page.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Phone</th>
              <th scope="col">Email</th>
              <th scope="col">Status</th>
              <th scope="col">Attempts</th>
              <th scope="col">Scheduled at</th>
              <th scope="col">Completed at</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.firstName} {item.lastName ?? ""}
                </td>
                <td>{item.phone}</td>
                <td>{item.email ?? "—"}</td>
                <td>{item.status}</td>
                <td>{item.attempts}</td>
                <td>{item.scheduledAt ?? "—"}</td>
                <td>{item.completedAt ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {page && (
        <nav aria-label="Recipient pages">
          <button
            type="button"
            disabled={query.offset === 0}
            onClick={() =>
              setQuery((current) => ({
                ...current,
                offset: Math.max(0, current.offset - current.limit),
              }))
            }
          >
            Previous page
          </button>
          <button
            type="button"
            disabled={query.offset + query.limit >= page.total}
            onClick={() =>
              setQuery((current) => ({ ...current, offset: current.offset + current.limit }))
            }
          >
            Next page
          </button>
        </nav>
      )}
    </main>
  );
}
