import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ConfirmDialog } from "../contacts/ConfirmDialog.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import type { CrmUiError } from "../core/result.js";
import type { ListsScreenProps } from "./adapter.js";
import type { ContactListInput, ContactListPage, ContactListVm, ListQuery } from "./types.js";

const PAGE_SIZE = 20;
const emptyInput = (): ContactListInput => ({
  name: "",
  description: null,
  color: null,
  kind: "list",
  definition: null,
});

export function ListsScreen({
  adapter,
  capabilities,
  navigation,
  className,
}: ListsScreenProps) {
  const [page, setPage] = useState<ContactListPage | null>(null);
  const [query, setQuery] = useState<ListQuery>({ limit: PAGE_SIZE, offset: 0 });
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<ContactListInput>(emptyInput);
  const [editing, setEditing] = useState<ContactListVm | null>(null);
  const [deleting, setDeleting] = useState<ContactListVm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const request = useRef(0);
  const createOperation = useCrmOperation(`create:${capabilities.create}`);
  const editOperation = useCrmOperation(
    `edit:${editing?.id ?? ""}:${capabilities.update}`,
  );
  const deleteOperation = useCrmOperation(
    `delete:${deleting?.id ?? ""}:${capabilities.remove}`,
  );

  const load = useCallback(async () => {
    const token = ++request.current;
    setLoading(true);
    setLoadError(null);
    const result = await safeAdapterCall(() => adapter.listLists(query));
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
    if (!capabilities.update) setEditing(null);
  }, [capabilities.update]);
  useIsomorphicLayoutEffect(() => {
    if (!capabilities.remove) setDeleting(null);
  }, [capabilities.remove]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery((current) => ({ ...current, search: search.trim() || undefined, offset: 0 }));
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name || !capabilities.create) return;
    const input = { ...draft, name };
    await createOperation.start(() => adapter.createList(input), () => {
      setDraft(emptyInput());
      void load();
    });
  }

  async function update(event: FormEvent) {
    event.preventDefault();
    if (!editing || !capabilities.update) return;
    const target = editing;
    const name = target.name.trim();
    if (!name) return;
    await editOperation.start(
      () =>
        adapter.updateList(target.id, {
          name,
          description: target.description,
          color: target.color,
        }),
      () => {
        setEditing(null);
        void load();
      },
    );
  }

  async function remove() {
    if (!deleting || !capabilities.remove) return;
    const target = deleting;
    await deleteOperation.start(() => adapter.deleteList(target.id), () => void load());
    setDeleting(null);
  }

  return (
    <main className={className}>
      <h1>Lists</h1>
      <form role="search" onSubmit={submitSearch}>
        <label>
          Search lists
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button type="submit">Search</button>
      </form>

      {capabilities.create && (
        <form onSubmit={create}>
          <h2>Create list</h2>
          <label>
            List name
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <label>
            Description
            <input
              value={draft.description ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value || null,
                }))
              }
            />
          </label>
          <button type="submit" disabled={createOperation.pending}>
            Create list
          </button>
          {createOperation.error && (
            <ErrorNotice
              error={createOperation.error}
              retryLabel="Retry creating list"
              onRetry={createOperation.retry}
            />
          )}
        </form>
      )}

      {loading && <p role="status">Loading lists…</p>}
      {loadError && (
        <ErrorNotice error={loadError} retryLabel="Retry loading lists" onRetry={() => void load()} />
      )}
      {!loading && !loadError && page?.items.length === 0 && <p>No lists found.</p>}
      {!loading && !loadError && page && page.items.length > 0 && (
        <ul>
          {page.items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => navigation.list(item.id)}>
                {item.name}
              </button>
              <span>{item.memberCount} members</span>
              {capabilities.update && (
                <button type="button" onClick={() => setEditing(item)}>
                  Edit {item.name}
                </button>
              )}
              {capabilities.remove && (
                <button type="button" onClick={() => setDeleting(item)}>
                  Delete {item.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && capabilities.update && (
        <form onSubmit={update}>
          <h2>Edit list</h2>
          <label>
            Edit list name
            <input
              value={editing.name}
              onChange={(event) =>
                setEditing((current) => (current ? { ...current, name: event.target.value } : null))
              }
              required
            />
          </label>
          <label>
            Edit description
            <input
              value={editing.description ?? ""}
              onChange={(event) =>
                setEditing((current) =>
                  current ? { ...current, description: event.target.value || null } : null,
                )
              }
            />
          </label>
          <button type="button" onClick={() => setEditing(null)}>
            Cancel editing
          </button>
          <button type="submit" disabled={editOperation.pending}>
            Save list
          </button>
          {editOperation.error && (
            <ErrorNotice
              error={editOperation.error}
              retryLabel="Retry updating list"
              onRetry={editOperation.retry}
            />
          )}
        </form>
      )}

      {deleting && capabilities.remove && (
        <ConfirmDialog
          titleId="delete-list-title"
          title={`Delete ${deleting.name}?`}
          confirmLabel="Confirm delete"
          pending={deleteOperation.pending}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      )}
      {capabilities.remove && deleteOperation.error && (
        <ErrorNotice
          error={deleteOperation.error}
          retryLabel="Retry deleting list"
          onRetry={deleteOperation.retry}
        />
      )}

      {page && (
        <nav aria-label="List pages">
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
