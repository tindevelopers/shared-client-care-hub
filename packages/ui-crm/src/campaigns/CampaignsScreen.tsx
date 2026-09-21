import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import type { CrmUiError } from "../core/result.js";
import type { CampaignsScreenProps } from "./adapter.js";
import type { CampaignPage, CampaignQuery } from "./types.js";

const PAGE_SIZE = 20;

export function CampaignsScreen({
  adapter,
  capabilities,
  navigation,
  className,
}: CampaignsScreenProps) {
  const [page, setPage] = useState<CampaignPage | null>(null);
  const [query, setQuery] = useState<CampaignQuery>({ limit: PAGE_SIZE, offset: 0 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CrmUiError | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const token = ++request.current;
    setLoading(true);
    setError(null);
    const result = await safeAdapterCall(() => adapter.listCampaigns(query));
    if (token !== request.current) return;
    setLoading(false);
    if (result.ok) setPage(result.data);
    else {
      setPage(null);
      setError(result.error);
    }
  }, [adapter, query]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery((current) => ({ ...current, search: search.trim() || undefined, offset: 0 }));
  }

  return (
    <main className={className}>
      <h1>Campaigns</h1>
      {capabilities.create && (
        <button type="button" onClick={() => navigation.newCampaign()}>
          New campaign
        </button>
      )}
      <form role="search" onSubmit={submitSearch}>
        <label>
          Search campaigns
          <input type="search" value={search}
            onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button type="submit">Search</button>
      </form>
      {loading && <p role="status">Loading campaigns…</p>}
      {error && <ErrorNotice error={error} retryLabel="Retry loading campaigns"
        onRetry={() => void load()} />}
      {!loading && !error && page?.items.length === 0 && <p>No campaigns found.</p>}
      {!loading && !error && page && page.items.length > 0 && (
        <ul>
          {page.items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => navigation.campaign(item.id)}>
                {item.name}
              </button>
              <span>{item.status ?? "Unknown status"}</span>
              <span>{item.campaign_type}</span>
            </li>
          ))}
        </ul>
      )}
      {page && (
        <nav aria-label="Campaign pages">
          <button type="button" disabled={query.offset === 0}
            onClick={() => setQuery((current) => ({
              ...current, offset: Math.max(0, current.offset - current.limit),
            }))}>
            Previous page
          </button>
          <button type="button" disabled={query.offset + query.limit >= page.total}
            onClick={() => setQuery((current) => ({
              ...current, offset: current.offset + current.limit,
            }))}>
            Next page
          </button>
        </nav>
      )}
    </main>
  );
}
