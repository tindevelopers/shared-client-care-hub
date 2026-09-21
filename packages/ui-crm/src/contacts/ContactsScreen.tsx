import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CrmUiError } from "../core/result.js";
import type { ContactsScreenProps } from "./adapter.js";
import { BulkActionBar } from "./BulkActionBar.js";
import { ErrorNotice } from "./ErrorNotice.js";
import type { ContactPage, ContactQuery } from "./types.js";

const PAGE_SIZE = 20;

export function ContactsScreen({
  adapter,
  capabilities,
  navigation,
  className,
}: ContactsScreenProps) {
  const [page, setPage] = useState<ContactPage | null>(null);
  const [query, setQuery] = useState<ContactQuery>({ limit: PAGE_SIZE, offset: 0 });
  const [search, setSearch] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * Identity of the in-flight list request. A response that is not the newest
   * request is dropped, so a slow page/search result can neither overwrite a
   * newer one nor clear its loading state.
   */
  const request = useRef(0);

  const load = useCallback(async () => {
    const token = ++request.current;
    setLoading(true);
    setLoadError(null);
    const result = await adapter.listContacts(query);
    if (token !== request.current) return;
    setLoading(false);
    if (result.ok) {
      setPage(result.data);
      // Selection is scoped to the rows this response actually returned.
      const ids = new Set(result.data.items.map((item) => item.id));
      setSelected((current) => current.filter((id) => ids.has(id)));
    } else {
      // Never keep rows from a different query on screen next to an error.
      setPage(null);
      setLoadError(result.error);
    }
  }, [adapter, query]);

  useEffect(() => {
    void load();
    return () => {
      // Invalidate this load: an unmounted or superseded screen never applies it.
      request.current += 1;
    };
  }, [load]);

  // A new query is a new result set: nothing stays selected across it.
  useEffect(() => {
    setSelected([]);
  }, [query]);

  useEffect(() => {
    let active = true;
    void adapter.listTags().then((result) => {
      if (active && result.ok) setTags(result.data);
    });
    return () => {
      active = false;
    };
  }, [adapter]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery((current) => ({
      ...current,
      search: search.trim() || undefined,
      offset: 0,
    }));
  }

  function select(id: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id),
    );
  }

  return (
    <main className={className}>
      <header>
        <h1>Contacts</h1>
        {capabilities.create && (
          <button type="button" onClick={navigation.newContact}>
            New contact
          </button>
        )}
        {capabilities.import && (
          <button type="button" onClick={navigation.importContacts}>
            Import contacts
          </button>
        )}
      </header>

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
      <label>
        Tag
        <select
          value={query.tag ?? ""}
          onChange={(event) =>
            setQuery((current) => ({
              ...current,
              tag: event.target.value || undefined,
              offset: 0,
            }))
          }
        >
          <option value="">All tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </label>

      {capabilities.bulkActions && (
        <BulkActionBar
          adapter={adapter}
          selectedIds={selected}
          canRemove={capabilities.remove}
          canTag={capabilities.update}
          onComplete={() => {
            setSelected([]);
            void load();
          }}
        />
      )}

      {loading && <p role="status">Loading contacts…</p>}
      {loadError && (
        <ErrorNotice
          error={loadError}
          retryLabel="Retry loading contacts"
          onRetry={() => void load()}
        />
      )}
      {!loading && !loadError && page?.items.length === 0 && <p>No contacts found.</p>}
      {!loading && !loadError && page && page.items.length > 0 && (
        <table>
          <thead>
            <tr>
              {capabilities.bulkActions && <th scope="col">Select</th>}
              <th scope="col">Name</th>
              <th scope="col">Company</th>
              <th scope="col">Email</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((contact) => (
              <tr key={contact.id}>
                {capabilities.bulkActions && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${contact.first_name} ${contact.last_name}`}
                      checked={selected.includes(contact.id)}
                      onChange={(event) => select(contact.id, event.target.checked)}
                    />
                  </td>
                )}
                <td>
                  <button type="button" onClick={() => navigation.contact(contact.id)}>
                    {contact.first_name} {contact.last_name}
                  </button>
                </td>
                <td>{contact.companyName ?? "—"}</td>
                <td>{contact.email ?? "—"}</td>
                <td>{contact.updated_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {page && (
        <nav aria-label="Contact pages">
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
              setQuery((current) => ({
                ...current,
                offset: current.offset + current.limit,
              }))
            }
          >
            Next page
          </button>
        </nav>
      )}
    </main>
  );
}
