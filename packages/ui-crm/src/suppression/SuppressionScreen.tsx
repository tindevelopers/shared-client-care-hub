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
  selectionDisabled: boolean;
  selected: boolean;
  onSelect(checked: boolean): void;
  onComplete(): void;
}

function SuppressionRow({
  adapter,
  item,
  allowed,
  selectable,
  selectionDisabled,
  selected,
  onSelect,
  onComplete,
}: RowProps) {
  const [reason, setReason] = useState(item.reason ?? "");
  const [source, setSource] = useState(item.source);
  const [locked, setLocked] = useState(false);
  const lock = useRef(false);
  const input: SetSuppressionInput = {
    contact_id: item.contact_id,
    channel: item.channel,
    suppressed: !item.suppressed,
    reason: reason.trim() || null,
    source: source.trim() || "manual",
    metadata: item.metadata,
  };
  const revisionKey = JSON.stringify({
    id: item.id,
    updatedAt: item.updated_at,
    reason: item.reason,
    source: item.source,
    suppressed: item.suppressed,
    metadata: item.metadata,
  });
  const operation = useCrmOperation(
    JSON.stringify({ operation: "set-suppression", allowed, input }),
  );

  useIsomorphicLayoutEffect(() => {
    setReason(item.reason ?? "");
    setSource(item.source);
  }, [revisionKey]);

  async function setSuppression() {
    if (!allowed || lock.current) return;
    lock.current = true;
    setLocked(true);
    try {
      await operation.start(() => adapter.setSuppression(input), onComplete);
    } finally {
      lock.current = false;
      setLocked(false);
    }
  }

  async function retry() {
    if (lock.current) return;
    lock.current = true;
    setLocked(true);
    try {
      await operation.retry();
    } finally {
      lock.current = false;
      setLocked(false);
    }
  }

  return (
    <tr>
      {selectable && (
        <td>
          <input
            type="checkbox"
            aria-label={`Select ${contactLabel(item)} ${item.channel}`}
            checked={selected}
            disabled={selectionDisabled}
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
            disabled={locked}
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
            disabled={locked}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        ) : (
          item.source
        )}
      </td>
      {allowed && (
        <td>
          <button type="button" disabled={locked} onClick={() => void setSuppression()}>
            {item.suppressed ? "Allow" : "Suppress"} {item.channel}
          </button>
          {operation.error && (
            <ErrorNotice
              error={operation.error}
              retryLabel={`Retry setting ${item.channel} suppression`}
              onRetry={() => void retry()}
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
  const [bulkLocked, setBulkLocked] = useState(false);
  const request = useRef(0);
  const bulkLock = useRef(false);
  const queryKey = JSON.stringify(query);
  const bulkInput = {
    contactIds: selected,
    channel: bulkChannel,
    suppressed: bulkSuppressed,
    reason: bulkReason.trim() || null,
    source: bulkSource.trim() || "manual",
    metadata: {},
  };
  const bulkOperation = useCrmOperation(
    JSON.stringify({
      operation: "bulk-set-suppression",
      query,
      allowed: capabilities.update && capabilities.bulkActions,
      input: bulkInput,
    }),
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
      const ids = new Set(
        result.data.items
          .filter((item) => item.channel === bulkChannel)
          .map((item) => item.contact_id),
      );
      setSelected((current) => current.filter((id) => ids.has(id)));
    } else {
      setPage(null);
      setLoadError(result.error);
    }
  }, [adapter, bulkChannel, query]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  useIsomorphicLayoutEffect(() => setSelected([]), [queryKey]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (bulkLock.current) return;
    setQuery((current) => ({ ...current, search: search.trim() || undefined, offset: 0 }));
  }

  function select(id: string, channel: SuppressionChannel, checked: boolean) {
    if (bulkLock.current) return;
    if (!checked) {
      setSelected((current) => current.filter((item) => item !== id));
      return;
    }
    if (channel !== bulkChannel) {
      setBulkChannel(channel);
      setSelected([id]);
      return;
    }
    setSelected((current) => (current.includes(id) ? current : [...current, id]));
  }

  async function bulkSet() {
    if (
      !capabilities.update ||
      !capabilities.bulkActions ||
      !selected.length ||
      bulkLock.current
    )
      return;
    const input = { ...bulkInput, contactIds: [...bulkInput.contactIds] };
    bulkLock.current = true;
    setBulkLocked(true);
    try {
      await bulkOperation.start(() => adapter.bulkSetSuppression(input), () => {
        setSelected([]);
        void load();
      });
    } finally {
      bulkLock.current = false;
      setBulkLocked(false);
    }
  }

  async function retryBulk() {
    if (bulkLock.current) return;
    bulkLock.current = true;
    setBulkLocked(true);
    try {
      await bulkOperation.retry();
    } finally {
      bulkLock.current = false;
      setBulkLocked(false);
    }
  }

  const canBulk = capabilities.update && capabilities.bulkActions;

  return (
    <main className={className}>
      <h1>Suppression</h1>
      <form role="search" onSubmit={submitSearch}>
        <label>
          Search suppression
          <input
            type="search"
            disabled={bulkLocked}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button type="submit" disabled={bulkLocked}>
          Search
        </button>
      </form>
      <label>
        Channel
        <select
          disabled={bulkLocked}
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
          disabled={bulkLocked}
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
              disabled={bulkLocked}
              value={bulkChannel}
              onChange={(event) => {
                setBulkChannel(event.target.value as SuppressionChannel);
                setSelected([]);
              }}
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
              disabled={bulkLocked}
              value={String(bulkSuppressed)}
              onChange={(event) => setBulkSuppressed(event.target.value === "true")}
            >
              <option value="true">Suppressed</option>
              <option value="false">Allowed</option>
            </select>
          </label>
          <label>
            Bulk reason
            <input
              disabled={bulkLocked}
              value={bulkReason}
              onChange={(event) => setBulkReason(event.target.value)}
            />
          </label>
          <label>
            Bulk source
            <input
              disabled={bulkLocked}
              value={bulkSource}
              onChange={(event) => setBulkSource(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!selected.length || bulkLocked}
            onClick={() => void bulkSet()}
          >
            Set selected suppression
          </button>
          {bulkOperation.error && (
            <ErrorNotice
              error={bulkOperation.error}
              retryLabel="Retry setting selected suppression"
              onRetry={() => void retryBulk()}
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
                selectionDisabled={bulkLocked}
                selected={
                  item.channel === bulkChannel && selected.includes(item.contact_id)
                }
                onSelect={(checked) => select(item.contact_id, item.channel, checked)}
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
            disabled={bulkLocked || query.offset === 0}
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
            disabled={bulkLocked || query.offset + query.limit >= page.total}
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
