import { useCallback, useEffect, useRef, useState } from "react";
import type { CampaignRecipientStatus } from "@tindevelopers/schema-crm";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import type { CrmUiError } from "../core/result.js";
import type { CampaignRecipientsScreenProps } from "./adapter.js";
import type { CampaignRecipientPage, RecipientQuery } from "./types.js";

const PAGE_SIZE = 20;
const STATUSES: CampaignRecipientStatus[] = [
  "pending", "scheduled", "in_progress", "completed", "failed",
  "skipped", "opted_out", "no_answer", "voicemail",
];

export function CampaignRecipientsScreen({
  adapter,
  campaignId,
  className,
}: CampaignRecipientsScreenProps) {
  const [page, setPage] = useState<CampaignRecipientPage | null>(null);
  const [query, setQuery] = useState<RecipientQuery>({ limit: PAGE_SIZE, offset: 0 });
  const [error, setError] = useState<CrmUiError | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);

  const load = useCallback(async () => {
    const token = ++request.current;
    setPage(null);
    setError(null);
    setLoading(true);
    const result = await safeAdapterCall(() => adapter.listRecipients(campaignId, query));
    if (token !== request.current) return;
    setLoading(false);
    if (result.ok) setPage(result.data);
    else setError(result.error);
  }, [adapter, campaignId, query]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  return (
    <main className={className}>
      <h1>Campaign recipients</h1>
      <label>
        Recipient status
        <select value={query.status ?? ""}
          onChange={(event) => setQuery((current) => ({
            ...current,
            status: (event.target.value || undefined) as CampaignRecipientStatus | undefined,
            offset: 0,
          }))}>
          <option value="">All statuses</option>
          {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </label>
      {loading && <p role="status">Loading recipients…</p>}
      {error && <ErrorNotice error={error} retryLabel="Retry loading recipients"
        onRetry={() => void load()} />}
      {!loading && !error && page?.items.length === 0 && <p>No recipients found.</p>}
      {page && page.items.length > 0 && (
        <table>
          <thead><tr>
            <th scope="col">Recipient</th><th scope="col">Phone</th>
            <th scope="col">Status</th><th scope="col">Attempts</th>
          </tr></thead>
          <tbody>{page.items.map((recipient) => (
            <tr key={recipient.id}>
              <th scope="row">{recipient.firstName} {recipient.lastName}</th>
              <td>{recipient.phone}</td><td>{recipient.status}</td>
              <td>{recipient.attempts}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {page && (
        <nav aria-label="Recipient pages">
          <button type="button" disabled={query.offset === 0}
            onClick={() => setQuery((current) => ({
              ...current, offset: Math.max(0, current.offset - current.limit),
            }))}>Previous recipients</button>
          <button type="button" disabled={query.offset + query.limit >= page.total}
            onClick={() => setQuery((current) => ({
              ...current, offset: current.offset + current.limit,
            }))}>Next recipients</button>
        </nav>
      )}
    </main>
  );
}
