import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { safeAdapterCall } from "../contacts/adapterError.js";
import { ConfirmDialog } from "../contacts/ConfirmDialog.js";
import { ErrorNotice } from "../contacts/ErrorNotice.js";
import { useCrmOperation } from "../contacts/useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "../contacts/useIsomorphicLayoutEffect.js";
import type { ContactPage, ContactQuery, ContactSummaryVm } from "../contacts/types.js";
import type { CrmUiError } from "../core/result.js";
import type { ListDetailScreenProps } from "./adapter.js";
import type { ContactListDetailVm } from "./types.js";

const PAGE_SIZE = 20;

function label(contact: ContactSummaryVm) {
  return `${contact.first_name} ${contact.last_name}`;
}

export function ListDetailScreen({
  adapter,
  capabilities,
  listId,
  className,
}: ListDetailScreenProps) {
  const [list, setList] = useState<ContactListDetailVm | null>(null);
  const [contacts, setContacts] = useState<ContactPage | null>(null);
  const [query, setQuery] = useState<ContactQuery>({ limit: PAGE_SIZE, offset: 0 });
  const [search, setSearch] = useState("");
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [selectedToRemove, setSelectedToRemove] = useState<string[]>([]);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const [searchError, setSearchError] = useState<CrmUiError | null>(null);
  const detailRequest = useRef(0);
  const searchRequest = useRef(0);
  const removalKey = JSON.stringify(selectedToRemove);
  const queryKey = JSON.stringify(query);
  const addOperation = useCrmOperation(
    JSON.stringify({
      operation: "add-members",
      listId,
      query,
      contactIds: selectedToAdd,
      allowed: capabilities.update && capabilities.bulkActions,
    }),
  );
  const removeOperation = useCrmOperation(
    JSON.stringify({
      operation: "remove-members",
      listId,
      contactIds: selectedToRemove,
      allowed: capabilities.remove && capabilities.bulkActions,
    }),
  );
  const visible = list?.id === listId ? list : null;

  const load = useCallback(async () => {
    const token = ++detailRequest.current;
    setList(null);
    setLoadError(null);
    const result = await safeAdapterCall(() => adapter.getList(listId));
    if (token !== detailRequest.current) return;
    if (!result.ok) setLoadError(result.error);
    else if (!result.data) {
      setLoadError({ code: "not_found", message: "List not found.", retryable: false });
    } else setList(result.data);
  }, [adapter, listId]);

  const searchContacts = useCallback(async () => {
    const token = ++searchRequest.current;
    setContacts(null);
    setSearchError(null);
    const result = await safeAdapterCall(() => adapter.searchContacts(query));
    if (token !== searchRequest.current) return;
    if (result.ok) setContacts(result.data);
    else setSearchError(result.error);
  }, [adapter, listId, query]);

  useEffect(() => {
    void load();
    return () => {
      detailRequest.current += 1;
    };
  }, [load]);

  useEffect(() => {
    void searchContacts();
    return () => {
      searchRequest.current += 1;
    };
  }, [searchContacts]);

  useIsomorphicLayoutEffect(() => setSelectedToAdd([]), [queryKey, listId]);
  useIsomorphicLayoutEffect(() => setSelectedToRemove([]), [listId]);
  useIsomorphicLayoutEffect(() => {
    setConfirmingRemoval(false);
  }, [listId, removalKey, capabilities.remove, capabilities.bulkActions]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery((current) => ({ ...current, search: search.trim() || undefined, offset: 0 }));
  }

  function toggle(
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    id: string,
    checked: boolean,
  ) {
    setter((current) =>
      checked ? (current.includes(id) ? current : [...current, id]) : current.filter((x) => x !== id),
    );
  }

  async function add() {
    if (!visible || !capabilities.update || !capabilities.bulkActions || !selectedToAdd.length) return;
    const ids = [...selectedToAdd];
    await addOperation.start(() => adapter.addMembers(visible.id, ids), () => {
      setSelectedToAdd([]);
      void load();
    });
  }

  async function remove() {
    if (
      !visible ||
      !capabilities.remove ||
      !capabilities.bulkActions ||
      !selectedToRemove.length
    )
      return;
    const ids = [...selectedToRemove];
    await removeOperation.start(() => adapter.removeMembers(visible.id, ids), () => {
      setSelectedToRemove([]);
      void load();
    });
    setConfirmingRemoval(false);
  }

  return (
    <main className={className}>
      {loadError && (
        <ErrorNotice error={loadError} retryLabel="Retry loading list" onRetry={() => void load()} />
      )}
      {!visible && !loadError && <p role="status">Loading list…</p>}
      {visible && (
        <>
          <h1>{visible.name}</h1>
          <section>
            <h2>Members</h2>
            {visible.members.items.length === 0 && <p>No members.</p>}
            <ul>
              {visible.members.items.map((contact) => (
                <li key={contact.id}>
                  {capabilities.remove && capabilities.bulkActions && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${label(contact)} for removal`}
                      checked={selectedToRemove.includes(contact.id)}
                      onChange={(event) =>
                        toggle(setSelectedToRemove, contact.id, event.target.checked)
                      }
                    />
                  )}
                  {label(contact)}
                </li>
              ))}
            </ul>
            {capabilities.remove && capabilities.bulkActions && (
              <button
                type="button"
                disabled={!selectedToRemove.length || removeOperation.pending}
                onClick={() => setConfirmingRemoval(true)}
              >
                Remove selected members
              </button>
            )}
            {confirmingRemoval && capabilities.remove && capabilities.bulkActions && (
              <ConfirmDialog
                titleId="remove-members-title"
                title="Remove selected members?"
                confirmLabel="Confirm removal"
                pending={removeOperation.pending}
                onConfirm={() => void remove()}
                onCancel={() => setConfirmingRemoval(false)}
              />
            )}
            {removeOperation.error && capabilities.remove && capabilities.bulkActions && (
              <ErrorNotice
                error={removeOperation.error}
                retryLabel="Retry removing members"
                onRetry={removeOperation.retry}
              />
            )}
          </section>

          <section>
            <h2>Add members</h2>
            <form role="search" onSubmit={submitSearch}>
              <label>
                Search contacts
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <button type="submit">Search</button>
            </form>
            {searchError && (
              <ErrorNotice
                error={searchError}
                retryLabel="Retry searching contacts"
                onRetry={() => void searchContacts()}
              />
            )}
            {contacts && (
              <>
                <ul>
                  {contacts.items.map((contact) => (
                    <li key={contact.id}>
                      {capabilities.update && capabilities.bulkActions && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${label(contact)} to add`}
                          checked={selectedToAdd.includes(contact.id)}
                          onChange={(event) =>
                            toggle(setSelectedToAdd, contact.id, event.target.checked)
                          }
                        />
                      )}
                      {label(contact)}
                    </li>
                  ))}
                </ul>
                <nav aria-label="Contact search pages">
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
                    Previous contacts
                  </button>
                  <button
                    type="button"
                    disabled={query.offset + query.limit >= contacts.total}
                    onClick={() =>
                      setQuery((current) => ({
                        ...current,
                        offset: current.offset + current.limit,
                      }))
                    }
                  >
                    Next contacts
                  </button>
                </nav>
              </>
            )}
            {capabilities.update && capabilities.bulkActions && (
              <button
                type="button"
                disabled={!selectedToAdd.length || addOperation.pending}
                onClick={() => void add()}
              >
                Add selected members
              </button>
            )}
            {addOperation.error && capabilities.update && capabilities.bulkActions && (
              <ErrorNotice
                error={addOperation.error}
                retryLabel="Retry adding members"
                onRetry={addOperation.retry}
              />
            )}
          </section>
        </>
      )}
    </main>
  );
}
