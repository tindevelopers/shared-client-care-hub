import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CrmUiError } from "../core/result.js";
import type { ContactDetailScreenProps } from "./adapter.js";
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
  const [note, setNote] = useState("");
  const [error, setError] = useState<CrmUiError | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [contactResult, activityResult, notesResult] = await Promise.all([
      adapter.getContact(contactId),
      adapter.listActivities(contactId),
      adapter.listNotes(contactId),
    ]);
    const failure = [contactResult, activityResult, notesResult].find((result) => !result.ok);
    if (failure && !failure.ok) {
      setError(failure.error);
      return;
    }
    if (contactResult.ok && !contactResult.data) {
      setError({ code: "not_found", message: "Contact not found.", retryable: false });
      return;
    }
    if (contactResult.ok) setContact(contactResult.data);
    if (activityResult.ok) setActivities(activityResult.data);
    if (notesResult.ok) setNotes(notesResult.data);
  }, [adapter, contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addNote(event: FormEvent) {
    event.preventDefault();
    const content = note.trim();
    if (!content) return;
    const result = await adapter.createNote(contactId, content);
    if (!result.ok) setError(result.error);
    else {
      setNotes((current) => [result.data, ...current]);
      setNote("");
    }
  }

  async function remove() {
    const result = await adapter.deleteContact(contactId);
    if (!result.ok) setError(result.error);
    else {
      setConfirmingDelete(false);
      navigation.contacts();
    }
  }

  return (
    <main className={className}>
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
      {contact && (
        <>
          <header>
            <h1>
              {contact.first_name} {contact.last_name}
            </h1>
            {quickActions}
            {capabilities.update && (
              <button type="button" onClick={() => navigation.editContact(contact.id)}>
                Edit contact
              </button>
            )}
            {capabilities.remove && (
              <button type="button" onClick={() => setConfirmingDelete(true)}>
                Delete contact
              </button>
            )}
          </header>
          {confirmingDelete && (
            <dialog open aria-labelledby="delete-contact-title">
              <h2 id="delete-contact-title">Delete this contact?</h2>
              <button type="button" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
              <button type="button" onClick={remove}>
                Confirm delete
              </button>
            </dialog>
          )}
          <dl>
            <dt>Email</dt>
            <dd>{contact.email ?? "—"}</dd>
            <dt>Phone</dt>
            <dd>{contact.phone ?? contact.mobile ?? "—"}</dd>
            <dt>Company</dt>
            <dd>{contact.companyName ?? "—"}</dd>
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
            <form onSubmit={addNote}>
              <label>
                Add note
                <textarea value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
              <button type="submit">Save note</button>
            </form>
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
