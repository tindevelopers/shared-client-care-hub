import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { SuppressionChannel } from "@tindevelopers/schema-crm";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import type { CrmUiError } from "../core/result.js";
import type { SuppressionAdapter, SuppressionScreenProps } from "./adapter.js";
import type {
  ContactSuppressionPage,
  ContactSuppressionVm,
  SetSuppressionInput,
  SuppressionQuery,
} from "./types.js";

const PAGE_SIZE = 20;
const CHANNELS: SuppressionChannel[] = ["email", "sms", "whatsapp"];

function contactLabel(item: ContactSuppressionVm) {
  return `${item.contact.first_name} ${item.contact.last_name}`;
}

interface RowProps {
  adapter: SuppressionAdapter;
  item: ContactSuppressionVm;
  allowed: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect(checked: boolean): void;
  onComplete(): void;
}

function SuppressionRow({
  adapter,
  item,
  allowed,
  selectable,
  selected,
  onSelect,
  onComplete,
}: RowProps) {
  const [reason, setReason] = useState(item.reason ?? "");
  const [source, setSource] = useState(item.source);
  const operation = useCrmOperation(`set:${item.id}:${item.contact_id}:${item.channel}:${allowed}`);

  async function setSuppression() {
    if (!allowed) return;
    const input: SetSuppressionInput = {
      contact_id: item.contact_id,
      channel: item.channel,
      suppressed: !item.suppressed,
      reason: reason.trim() || null,
      source: source.trim() || "manual",
      metadata: item.metadata,
    };
    await operation.start(() => adapter.setSuppression(input), onComplete);
  }

  return (
    <tr>
      {selectable && (
        <td>
          <input
            type="checkbox"
            aria-label={`Select ${contactLabel(item)} ${item.channel}`}
            checked={selected}
            onChange={(event) => onSelect(event.target.checked)}
          />
        </td>
      )}
      <td>{contactLabel(item)}</td>
      <td>{item.channel}</td>
      <td>{item.suppressed ? "Suppressed" : "Allowed"}</td>
      <td>
        {allowed ? (
          <input
            aria-label={`Reason for ${contactLabel(item)} ${item.channel}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        ) : (
          item.reason ?? "—"
        )}
      </td>
      <td>
        {allowed ? (
          <input
            aria-label={`Source for ${contactLabel(item)} ${item.channel}`}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        ) : (
          item.source
        )}
      </td>
      {allowed && (
        <td>
          <button type="button" disabled={operation.pending} onClick={() => void setSuppression()}>
            {item.suppressed ? "Allow" : "Suppress"} {item.channel}
          </button>
          {operation.error && (
            <ErrorNotice
              error={operation.error}
              retryLabel={`Retry setting ${item.channel} suppression`}
              onRetry={operation.retry}
            />
          )}
        </td>
      )}
    </tr>
  );
}

export function SuppressionScreen({
  adapter,
  capabilities,
  className,
}: SuppressionScreenProps) {
  const [page, setPage] = useState<ContactSuppressionPage | null>(null);
  const [query, setQuery] = useState<SuppressionQuery>({ limit: PAGE_SIZE, offset: 0 });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkChannel, setBulkChannel] = useState<SuppressionChannel>("email");
  const [bulkSuppressed, setBulkSuppressed] = useState(true);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkSource, setBulkSource] = useState("manual");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const request = useRef(0);
  const queryKey = JSON.stringify(query);
  const bulkOperation = useCrmOperation(
    `bulk:${queryKey}:${JSON.stringify(selected)}:${bulkChannel}:${bulkSuppressed}:${bulkReason}:${bulkSource}:${capabilities.update}:${capabilities.bulkActions}`,
  );

  const load = useCallback(async () => {
    const token = ++request.current;
    setLoading(true);
    setLoadError(null);
    const result = await safeAdapterCall(() => adapter.listSuppressions(query));
    if (token !== request.current) return;
    setLoading(false);
    if (result.ok) {
      setPage(result.data);
      const ids = new Set(result.data.items.map((item) => item.contact_id));
      setSelected((current) => current.filter((id) => ids.has(id)));
    } else {
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

  useIsomorphicLayoutEffect(() => setSelected([]), [queryKey]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery((current) => ({ ...current, search: search.trim() || undefined, offset: 0 }));
  }

  function select(id: string, checked: boolean) {
    setSelected((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((item) => item !== id),
    );
  }

  async function bulkSet() {
    if (!capabilities.update || !capabilities.bulkActions || !selected.length) return;
    const input = {
      contactIds: [...selected],
      channel: bulkChannel,
      suppressed: bulkSuppressed,
      reason: bulkReason.trim() || null,
      source: bulkSource.trim() || "manual",
      metadata: {},
    };
    await bulkOperation.start(() => adapter.bulkSetSuppression(input), () => {
      setSelected([]);
      void load();
    });
  }

  const canBulk = capabilities.update && capabilities.bulkActions;

  return (
    <main className={className}>
      <h1>Suppression</h1>
      <form role="search" onSubmit={submitSearch}>
        <label>
          Search suppression
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button type="submit">Search</button>
      </form>
      <label>
        Channel
        <select
          value={query.channel ?? ""}
          onChange={(event) =>
            setQuery((current) => ({
              ...current,
              channel: (event.target.value || undefined) as SuppressionChannel | undefined,
              offset: 0,
            }))
          }
        >
          <option value="">All channels</option>
          {CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {channel}
            </option>
          ))}
        </select>
      </label>
      <label>
        State
        <select
          value={query.suppressed === undefined ? "" : String(query.suppressed)}
          onChange={(event) =>
            setQuery((current) => ({
              ...current,
              suppressed: event.target.value === "" ? undefined : event.target.value === "true",
              offset: 0,
            }))
          }
        >
          <option value="">All states</option>
          <option value="true">Suppressed</option>
          <option value="false">Allowed</option>
        </select>
      </label>

      {canBulk && (
        <section aria-labelledby="bulk-suppression-title">
          <h2 id="bulk-suppression-title">Bulk suppression</h2>
          <label>
            Bulk channel
            <select
              value={bulkChannel}
              onChange={(event) => setBulkChannel(event.target.value as SuppressionChannel)}
            >
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bulk state
            <select
              value={String(bulkSuppressed)}
              onChange={(event) => setBulkSuppressed(event.target.value === "true")}
            >
              <option value="true">Suppressed</option>
              <option value="false">Allowed</option>
            </select>
          </label>
          <label>
            Bulk reason
            <input value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} />
          </label>
          <label>
            Bulk source
            <input value={bulkSource} onChange={(event) => setBulkSource(event.target.value)} />
          </label>
          <button
            type="button"
            disabled={!selected.length || bulkOperation.pending}
            onClick={() => void bulkSet()}
          >
            Set selected suppression
          </button>
          {bulkOperation.error && (
            <ErrorNotice
              error={bulkOperation.error}
              retryLabel="Retry setting selected suppression"
              onRetry={bulkOperation.retry}
            />
          )}
        </section>
      )}

      {loading && <p role="status">Loading suppression…</p>}
      {loadError && (
        <ErrorNotice
          error={loadError}
          retryLabel="Retry loading suppression"
          onRetry={() => void load()}
        />
      )}
      {!loading && !loadError && page?.items.length === 0 && <p>No suppression records found.</p>}
      {!loading && !loadError && page && page.items.length > 0 && (
        <table>
          <thead>
            <tr>
              {canBulk && <th scope="col">Select</th>}
              <th scope="col">Contact</th>
              <th scope="col">Channel</th>
              <th scope="col">State</th>
              <th scope="col">Reason</th>
              <th scope="col">Source</th>
              {capabilities.update && <th scope="col">Action</th>}
            </tr>
          </thead>
          <tbody>
            {page.items.map((item) => (
              <SuppressionRow
                key={item.id}
                adapter={adapter}
                item={item}
                allowed={capabilities.update}
                selectable={canBulk}
                selected={selected.includes(item.contact_id)}
                onSelect={(checked) => select(item.contact_id, checked)}
                onComplete={() => void load()}
              />
            ))}
          </tbody>
        </table>
      )}

      {page && (
        <nav aria-label="Suppression pages">
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
