import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CampaignStatus, CampaignType } from "@tindevelopers/schema-crm";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ConfirmDialog } from "../contacts/ConfirmDialog.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import type { CrmUiError } from "../core/result.js";
import type { CampaignsScreenProps } from "./adapter.js";
import type { CampaignPage, CampaignQuery, CampaignSummaryVm } from "./types.js";

const PAGE_SIZE = 20;
const STATUSES: CampaignStatus[] = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "sent",
  "completed",
  "cancelled",
];
const TYPES: CampaignType[] = ["voice", "sms", "whatsapp", "multi_channel", "email"];

export function CampaignsScreen({
  adapter,
  capabilities,
  navigation,
  className,
}: CampaignsScreenProps) {
  const [page, setPage] = useState<CampaignPage | null>(null);
  const [query, setQuery] = useState<CampaignQuery>({ limit: PAGE_SIZE, offset: 0 });
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<CampaignSummaryVm | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const request = useRef(0);
  const queryKey = JSON.stringify(query);
  const deleteOperation = useCrmOperation(
    JSON.stringify({
      operation: "delete",
      query: queryKey,
      id: deleting?.id ?? null,
      allowed: capabilities.remove,
    }),
  );

  const load = useCallback(async () => {
    const token = ++request.current;
    setLoading(true);
    setLoadError(null);
    const result = await safeAdapterCall(() => adapter.listCampaigns(query));
    if (token !== request.current) return;
    setLoading(false);
    if (result.ok) setPage(result.data);
    else {
      setPage(null);
      setLoadError(result.error);
    }
  }, [adapter, query]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  useIsomorphicLayoutEffect(() => {
    if (!capabilities.remove) {
      setDeleting(null);
      setConfirmingDelete(false);
    }
  }, [capabilities.remove]);
  useIsomorphicLayoutEffect(() => {
    setDeleting(null);
    setConfirmingDelete(false);
  }, [queryKey]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery((current) => ({ ...current, search: search.trim() || undefined, offset: 0 }));
  }

  async function remove() {
    if (!deleting || !capabilities.remove) return;
    const target = deleting;
    setConfirmingDelete(false);
    await deleteOperation.start(() => adapter.deleteCampaign(target.id), () => {
      setDeleting(null);
      void load();
    });
  }

  return (
    <main className={className}>
      <h1>Campaigns</h1>
      <form role="search" onSubmit={submitSearch}>
        <label>
          Search campaigns
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button type="submit">Search</button>
      </form>
      <label>
        Status
        <select
          value={query.status ?? ""}
          onChange={(event) =>
            setQuery((current) => ({
              ...current,
              status: (event.target.value || undefined) as CampaignStatus | undefined,
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
      <label>
        Type
        <select
          value={query.type ?? ""}
          onChange={(event) =>
            setQuery((current) => ({
              ...current,
              type: (event.target.value || undefined) as CampaignType | undefined,
              offset: 0,
            }))
          }
        >
          <option value="">All types</option>
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      {capabilities.create && (
        <button type="button" onClick={navigation.newCampaign}>
          New campaign
        </button>
      )}

      {loading && <p role="status">Loading campaigns…</p>}
      {loadError && (
        <ErrorNotice
          error={loadError}
          retryLabel="Retry loading campaigns"
          onRetry={() => void load()}
        />
      )}
      {!loading && !loadError && page?.items.length === 0 && <p>No campaigns found.</p>}
      {!loading && !loadError && page && page.items.length > 0 && (
        <ul>
          {page.items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => navigation.campaign(item.id)}>
                {item.name}
              </button>
              <span>{item.status ?? "draft"}</span>
              <span>{item.campaign_type}</span>
              {capabilities.update && (
                <button type="button" onClick={() => navigation.editCampaign(item.id)}>
                  Edit {item.name}
                </button>
              )}
              {capabilities.remove && (
                <button
                  type="button"
                  onClick={() => {
                    setDeleting(item);
                    setConfirmingDelete(true);
                  }}
                >
                  Delete {item.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleting && confirmingDelete && capabilities.remove && (
        <ConfirmDialog
          titleId="delete-campaign-title"
          title={`Delete ${deleting.name}?`}
          confirmLabel="Confirm delete"
          pending={deleteOperation.pending}
          onConfirm={() => void remove()}
          onCancel={() => {
            setConfirmingDelete(false);
            setDeleting(null);
          }}
        />
      )}
      {capabilities.remove && deleteOperation.error && (
        <ErrorNotice
          error={deleteOperation.error}
          retryLabel="Retry deleting campaign"
          onRetry={deleteOperation.retry}
        />
      )}

      {page && (
        <nav aria-label="Campaign pages">
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
