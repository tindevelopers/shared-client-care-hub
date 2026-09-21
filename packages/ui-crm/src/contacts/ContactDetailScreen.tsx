import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CrmUiError } from "../core/result.js";
import type { ContactDetailScreenProps } from "./adapter.js";
import { safeAdapterCall } from "./adapterError.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ErrorNotice } from "./ErrorNotice.js";
import { useCrmOperation } from "./useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect.js";
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
  // Scopes tie each operation to the contact and the capability it was started
  // with; a change drops its pending result, its error, and its retry.
  const deleteScope = `delete:${contactId}:${capabilities.remove}`;
  const noteOperation = useCrmOperation(`note:${contactId}:${capabilities.update}`);
  const deleteOperation = useCrmOperation(deleteScope);
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
      safeAdapterCall(() => adapter.getContact(contactId)),
      safeAdapterCall(() => adapter.listActivities(contactId)),
      safeAdapterCall(() => adapter.listNotes(contactId)),
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
    return () => {
      // Invalidate this load: an unmounted or superseded screen never applies it.
      request.current += 1;
    };
  }, [load]);

  // Another contact is another draft.
  useIsomorphicLayoutEffect(() => {
    setDraft("");
  }, [contactId]);

  // The confirmation belongs to one contact and one capability grant: retire it
  // on any change, so it can neither follow a new target nor resurrect when a
  // revoked capability comes back.
  useIsomorphicLayoutEffect(() => {
    setConfirmingDelete(false);
  }, [deleteScope]);

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
          {capabilities.remove && confirmingDelete && (
            <ConfirmDialog
              titleId="delete-contact-title"
              title="Delete this contact?"
              confirmLabel="Confirm delete"
              pending={deleteOperation.pending}
              onConfirm={() => void remove()}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}
          {capabilities.remove && deleteOperation.error && (
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
            {capabilities.update && noteOperation.error && (
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
