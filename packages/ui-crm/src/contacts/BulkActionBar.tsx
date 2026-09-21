import { useState } from "react";
import type { ContactsAdapter } from "./adapter.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ErrorNotice } from "./ErrorNotice.js";
import { useCrmOperation } from "./useCrmOperation.js";
import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect.js";

export interface BulkActionBarProps {
  adapter: ContactsAdapter;
  selectedIds: string[];
  canRemove: boolean;
  /**
   * Tag writes are contact updates. Fail closed: a host that does not pass the
   * update capability gets no tag controls.
   */
  canTag?: boolean;
  onComplete(): void;
}

export function BulkActionBar({
  adapter,
  selectedIds,
  canRemove,
  canTag = false,
  onComplete,
}: BulkActionBarProps) {
  const [tag, setTag] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // A bulk retry — and the confirmation itself — is only valid for the exact
  // selected-id set and capability it was created with. JSON rather than a
  // delimiter join, so the scope is the id set unambiguously.
  const selection = JSON.stringify(selectedIds);
  const deleteScope = `delete:${selection}:${canRemove}`;
  const tagOperation = useCrmOperation(`tag:${selection}:${canTag}`);
  const deleteOperation = useCrmOperation(deleteScope);

  // Retire the confirmation on any change: it must not follow a changed
  // selection, and it must not resurrect when a revoked capability returns.
  useIsomorphicLayoutEffect(() => {
    setConfirmingDelete(false);
  }, [deleteScope]);

  async function assign() {
    const value = tag.trim();
    if (!value || !selectedIds.length) return;
    // Snapshot the ids so a retry targets the contacts that were selected.
    const ids = [...selectedIds];
    await tagOperation.start(
      () => adapter.assignTags(ids, [value]),
      () => {
        setTag("");
        onComplete();
      },
    );
  }

  async function remove() {
    const ids = [...selectedIds];
    await deleteOperation.start(() => adapter.bulkDeleteContacts(ids), onComplete);
    // Close on failure too: outside a native modal the background is inert, so
    // the error and its retry have to be reachable.
    setConfirmingDelete(false);
  }

  return (
    <section aria-label="Bulk actions">
      <span>{selectedIds.length} selected</span>
      {canTag && (
        <>
          <label>
            Tag selected
            <input value={tag} onChange={(event) => setTag(event.target.value)} />
          </label>
          <button
            type="button"
            disabled={!selectedIds.length || tagOperation.pending}
            onClick={() => void assign()}
          >
            Assign tag
          </button>
          {tagOperation.error && (
            <ErrorNotice
              error={tagOperation.error}
              retryLabel="Retry assigning tag"
              onRetry={tagOperation.retry}
            />
          )}
        </>
      )}
      {canRemove && (
        <button
          type="button"
          disabled={!selectedIds.length || deleteOperation.pending}
          onClick={() => setConfirmingDelete(true)}
        >
          Delete selected
        </button>
      )}
      {canRemove && confirmingDelete && (
        <ConfirmDialog
          titleId="bulk-delete-title"
          title="Delete selected contacts?"
          confirmLabel="Confirm delete"
          pending={deleteOperation.pending}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
      {canRemove && deleteOperation.error && (
        <ErrorNotice
          error={deleteOperation.error}
          retryLabel="Retry deleting selected contacts"
          onRetry={deleteOperation.retry}
        />
      )}
    </section>
  );
}
