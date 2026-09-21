import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CrmUiError } from "../core/result.js";
import type { ContactDetailScreenProps } from "./adapter.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ErrorNotice } from "./ErrorNotice.js";
import { useCrmOperation } from "./useCrmOperation.js";
import type { ActivityVm, ContactDetailVm, NoteVm } from "./types.js";

export function ContactDetailScreen({
  adapter,
  capabilities,
  navigation,
  contactId,
  quickActions,
  className,
}: ContactDetailScreenProps) {
  const [contact, setContact] = useState<ContactDetailVm | null>(null);
  const [activities, setActivities] = useState<ActivityVm[]>([]);
  const [notes, setNotes] = useState<NoteVm[]>([]);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const noteOperation = useCrmOperation();
  const deleteOperation = useCrmOperation();
  /** Identity of the in-flight load; superseded responses are dropped. */
  const request = useRef(0);
  // Gate on identity, not just on presence: a response for another id can never
  // be rendered — or deleted/noted — here.
  const visible = contact && contact.id === contactId ? contact : null;

  const load = useCallback(async () => {
    const token = ++request.current;
    // Nothing stays on screen while another contact loads or after a failed
    // load: every destructive control must target the visible contact.
    setContact(null);
    setActivities([]);
    setNotes([]);
    setLoadError(null);
    const [contactResult, activityResult, notesResult] = await Promise.all([
      adapter.getContact(contactId),
      adapter.listActivities(contactId),
      adapter.listNotes(contactId),
    ]);
    if (token !== request.current) return;
    const failure = [contactResult, activityResult, notesResult].find((result) => !result.ok);
    if (failure && !failure.ok) {
      setLoadError(failure.error);
      return;
    }
    if (contactResult.ok && !contactResult.data) {
      setLoadError({ code: "not_found", message: "Contact not found.", retryable: false });
      return;
    }
    if (contactResult.ok) setContact(contactResult.data);
    if (activityResult.ok) setActivities(activityResult.data);
    if (notesResult.ok) setNotes(notesResult.data);
  }, [adapter, contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Another contact is another note draft.
  useEffect(() => {
    setDraft("");
  }, [contactId]);

  async function addNote(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !visible) return;
    const targetId = visible.id;
    await noteOperation.start(
      () => adapter.createNote(targetId, content),
      (created) => {
        setNotes((current) => [created, ...current]);
        setDraft("");
      },
    );
  }

  async function remove() {
    if (!visible) return;
    const targetId = visible.id;
    await deleteOperation.start(() => adapter.deleteContact(targetId), navigation.contacts);
    // Close on failure too: outside a native modal the background is inert, so
    // the error and its retry have to be reachable.
    setConfirmingDelete(false);
  }

  return (
    <main className={className}>
      {loadError && (
        <ErrorNotice
          error={loadError}
          retryLabel="Retry loading contact"
          onRetry={() => void load()}
        />
      )}
      {!visible && !loadError && <p role="status">Loading contact…</p>}
      {visible && (
        <>
          <header>
            <h1>
              {visible.first_name} {visible.last_name}
            </h1>
            {quickActions}
            {capabilities.update && (
              <button type="button" onClick={() => navigation.editContact(visible.id)}>
                Edit contact
              </button>
            )}
            {capabilities.remove && (
              <button
                type="button"
                disabled={deleteOperation.pending}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete contact
              </button>
            )}
          </header>
          {confirmingDelete && (
            <ConfirmDialog
              titleId="delete-contact-title"
              title="Delete this contact?"
              confirmLabel="Confirm delete"
              pending={deleteOperation.pending}
              onConfirm={() => void remove()}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}
          {deleteOperation.error && (
            <ErrorNotice
              error={deleteOperation.error}
              retryLabel="Retry deleting contact"
              onRetry={deleteOperation.retry}
            />
          )}
          <dl>
            <dt>Email</dt>
            <dd>{visible.email ?? "—"}</dd>
            <dt>Phone</dt>
            <dd>{visible.phone ?? visible.mobile ?? "—"}</dd>
            <dt>Company</dt>
            <dd>{visible.companyName ?? "—"}</dd>
          </dl>
          <section>
            <h2>Activity</h2>
            {activities.length === 0 ? (
              <p>No activity.</p>
            ) : (
              <ul>
                {activities.map((activity) => (
                  <li key={activity.id}>
                    <strong>{activity.title}</strong>
                    {activity.description && <p>{activity.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2>Notes</h2>
            {capabilities.update && (
              <form onSubmit={addNote}>
                <label>
                  Add note
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
                </label>
                <button type="submit" disabled={noteOperation.pending}>
                  Save note
                </button>
              </form>
            )}
            {noteOperation.error && (
              <ErrorNotice
                error={noteOperation.error}
                retryLabel="Retry saving note"
                onRetry={noteOperation.retry}
              />
            )}
            <ul>
              {notes.map((item) => (
                <li key={item.id}>{item.content}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
