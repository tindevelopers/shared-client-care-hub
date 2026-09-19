import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CrmUiError } from "../core/result.js";
import type { ContactsScreenProps } from "./adapter.js";
import { BulkActionBar } from "./BulkActionBar.js";
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
  const [error, setError] = useState<CrmUiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await adapter.listContacts(query);
    if (result.ok) setPage(result.data);
    else setError(result.error);
    setLoading(false);
  }, [adapter, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void adapter.listTags().then((result) => {
      if (result.ok) setTags(result.data);
    });
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
          onComplete={() => {
            setSelected([]);
            void load();
          }}
        />
      )}

      {loading && <p role="status">Loading contacts…</p>}
      {error && (
        <div role="alert">
          <p>{error.message}</p>
          {error.retryable && (
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          )}
        </div>
      )}
      {!loading && !error && page?.items.length === 0 && <p>No contacts found.</p>}
      {!loading && !error && page && page.items.length > 0 && (
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
