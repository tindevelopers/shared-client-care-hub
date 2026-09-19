import { useState } from "react";
import type { CrmUiError } from "../core/result.js";
import type { ContactsAdapter } from "./adapter.js";

export interface BulkActionBarProps {
  adapter: ContactsAdapter;
  selectedIds: string[];
  canRemove: boolean;
  onComplete(): void;
}

export function BulkActionBar({
  adapter,
  selectedIds,
  canRemove,
  onComplete,
}: BulkActionBarProps) {
  const [tag, setTag] = useState("");
  const [error, setError] = useState<CrmUiError | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function remove() {
    const result = await adapter.bulkDeleteContacts(selectedIds);
    if (!result.ok) setError(result.error);
    else {
      setConfirmingDelete(false);
      onComplete();
    }
  }

  async function assign() {
    const value = tag.trim();
    if (!value) return;
    const result = await adapter.assignTags(selectedIds, [value]);
    if (!result.ok) setError(result.error);
    else {
      setTag("");
      onComplete();
    }
  }

  return (
    <section aria-label="Bulk actions">
      <span>{selectedIds.length} selected</span>
      <label>
        Tag selected
        <input value={tag} onChange={(event) => setTag(event.target.value)} />
      </label>
      <button type="button" disabled={!selectedIds.length} onClick={assign}>
        Assign tag
      </button>
      {canRemove && (
        <button
          type="button"
          disabled={!selectedIds.length}
          onClick={() => setConfirmingDelete(true)}
        >
          Delete selected
        </button>
      )}
      {confirmingDelete && (
        <dialog open aria-labelledby="bulk-delete-title">
          <h2 id="bulk-delete-title">Delete selected contacts?</h2>
          <button type="button" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
          <button type="button" onClick={remove}>
            Confirm delete
          </button>
        </dialog>
      )}
      {error && <p role="alert">{error.message}</p>}
    </section>
  );
}
