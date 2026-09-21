import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ConfirmDialog } from "../contacts/ConfirmDialog.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import type { CrmUiError } from "../core/result.js";
import type { ListsScreenProps } from "./adapter.js";
import type {
  ContactListInput,
  ContactListPage,
  ContactListPatch,
  ContactListVm,
  ListQuery,
} from "./types.js";

const PAGE_SIZE = 20;
const emptyInput = (): ContactListInput => ({
  name: "",
  description: null,
  color: null,
  kind: "list",
  definition: null,
});

function normalizeInput(input: ContactListInput): ContactListInput {
  return {
    ...input,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    color: input.color?.trim() || null,
  };
}

function normalizePatch(input: ContactListVm): ContactListPatch {
  return {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    color: input.color?.trim() || null,
  };
}

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const [createLocked, setCreateLocked] = useState(false);
  const [editLocked, setEditLocked] = useState(false);
  const [deleteLocked, setDeleteLocked] = useState(false);
  const request = useRef(0);
  const createLock = useRef(false);
  const editLock = useRef(false);
  const deleteLock = useRef(false);
  const queryKey = JSON.stringify(query);
  const createPayload = normalizeInput(draft);
  const editPayload = editing ? normalizePatch(editing) : null;
  const createOperation = useCrmOperation(
    JSON.stringify({ operation: "create", allowed: capabilities.create, input: createPayload }),
  );
  const editOperation = useCrmOperation(
    JSON.stringify({
      operation: "edit",
      id: editing?.id ?? null,
      allowed: capabilities.update,
      input: editPayload,
    }),
  );
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
    if (!capabilities.remove) setConfirmingDelete(false);
  }, [capabilities.remove]);
  useIsomorphicLayoutEffect(() => {
    setDeleting(null);
    setConfirmingDelete(false);
  }, [queryKey]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (deleteLock.current) return;
    setQuery((current) => ({ ...current, search: search.trim() || undefined, offset: 0 }));
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const input = createPayload;
    if (!input.name || !capabilities.create || createLock.current) return;
    createLock.current = true;
    setCreateLocked(true);
    try {
      await createOperation.start(() => adapter.createList(input), () => {
        setDraft(emptyInput());
        void load();
      });
    } finally {
      createLock.current = false;
      setCreateLocked(false);
    }
  }

  async function update(event: FormEvent) {
    event.preventDefault();
    if (!editing || !capabilities.update || editLock.current) return;
    const target = editing;
    const patch = editPayload;
    if (!patch?.name) return;
    editLock.current = true;
    setEditLocked(true);
    try {
      await editOperation.start(
        () => adapter.updateList(target.id, patch),
        () => {
          setEditing(null);
          void load();
        },
      );
    } finally {
      editLock.current = false;
      setEditLocked(false);
    }
  }

  async function retryCreate() {
    if (createLock.current) return;
    createLock.current = true;
    setCreateLocked(true);
    try {
      await createOperation.retry();
    } finally {
      createLock.current = false;
      setCreateLocked(false);
    }
  }

  async function retryEdit() {
    if (editLock.current) return;
    editLock.current = true;
    setEditLocked(true);
    try {
      await editOperation.retry();
    } finally {
      editLock.current = false;
      setEditLocked(false);
    }
  }

  async function remove() {
    if (!deleting || !capabilities.remove || deleteLock.current) return;
    const target = deleting;
    deleteLock.current = true;
    setDeleteLocked(true);
    setConfirmingDelete(false);
    try {
      await deleteOperation.start(() => adapter.deleteList(target.id), () => {
        setDeleting(null);
        void load();
      });
    } finally {
      deleteLock.current = false;
      setDeleteLocked(false);
    }
  }

  async function retryDelete() {
    if (deleteLock.current) return;
    deleteLock.current = true;
    setDeleteLocked(true);
    try {
      await deleteOperation.retry();
    } finally {
      deleteLock.current = false;
      setDeleteLocked(false);
    }
  }

  return (
    <main className={className}>
      <h1>Lists</h1>
      <form role="search" onSubmit={submitSearch}>
        <label>
          Search lists
          <input
            type="search"
            disabled={deleteLocked}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button type="submit" disabled={deleteLocked}>
          Search
        </button>
      </form>

      {capabilities.create && (
        <form onSubmit={create}>
          <h2>Create list</h2>
          <label>
            List name
            <input
              aria-describedby={
                createOperation.error?.code === "duplicate_name" ? "create-list-error" : undefined
              }
              aria-invalid={createOperation.error?.code === "duplicate_name" || undefined}
              disabled={createLocked}
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <label>
            Description
            <input
              disabled={createLocked}
              value={draft.description ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value || null,
                }))
              }
            />
          </label>
          <button type="submit" disabled={createLocked}>
            Create list
          </button>
          {createOperation.error && (
            <div id="create-list-error">
              <ErrorNotice
                error={createOperation.error}
                retryLabel="Retry creating list"
                onRetry={() => void retryCreate()}
              />
            </div>
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
              <button
                type="button"
                disabled={deleteLocked}
                onClick={() => navigation.list(item.id)}
              >
                {item.name}
              </button>
              <span>{item.memberCount} members</span>
              {capabilities.update && (
                <button
                  type="button"
                  disabled={editLocked}
                  onClick={() => setEditing(item)}
                >
                  Edit {item.name}
                </button>
              )}
              {capabilities.remove && (
                <button
                  type="button"
                  disabled={deleteLocked}
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

      {editing && capabilities.update && (
        <form onSubmit={update}>
          <h2>Edit list</h2>
          <label>
            Edit list name
            <input
              aria-describedby={
                editOperation.error?.code === "duplicate_name" ? "edit-list-error" : undefined
              }
              aria-invalid={editOperation.error?.code === "duplicate_name" || undefined}
              disabled={editLocked}
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
              disabled={editLocked}
              value={editing.description ?? ""}
              onChange={(event) =>
                setEditing((current) =>
                  current ? { ...current, description: event.target.value || null } : null,
                )
              }
            />
          </label>
          <button
            type="button"
            disabled={editLocked}
            onClick={() => setEditing(null)}
          >
            Cancel editing
          </button>
          <button type="submit" disabled={editLocked}>
            Save list
          </button>
          {editOperation.error && (
            <div id="edit-list-error">
              <ErrorNotice
                error={editOperation.error}
                retryLabel="Retry updating list"
                onRetry={() => void retryEdit()}
              />
            </div>
          )}
        </form>
      )}

      {deleting && confirmingDelete && capabilities.remove && (
        <ConfirmDialog
          titleId="delete-list-title"
          title={`Delete ${deleting.name}?`}
          confirmLabel="Confirm delete"
          pending={deleteLocked}
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
          retryLabel="Retry deleting list"
          onRetry={() => void retryDelete()}
        />
      )}

      {page && (
        <nav aria-label="List pages">
          <button
            type="button"
            disabled={deleteLocked || query.offset === 0}
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
            disabled={deleteLocked || query.offset + query.limit >= page.total}
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
