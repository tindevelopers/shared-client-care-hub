import { useRef, useState, type ChangeEvent } from "react";
import type { ContactImportScreenProps } from "./adapter.js";
import { ErrorNotice } from "./ErrorNotice.js";
import { useCrmOperation } from "./useCrmOperation.js";
import type {
  ContactFieldMapping,
  ContactsImportPreview,
  ContactsImportResult,
  JsonRow,
  ParsedImport,
} from "./types.js";

type MappedField = ContactFieldMapping[string];

const FIELDS: Array<{ value: MappedField; label: string }> = [
  { value: "ignore", label: "Ignore" },
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "mobile", label: "Mobile" },
  { value: "job_title", label: "Job title" },
  { value: "department", label: "Department" },
  { value: "notes", label: "Notes" },
];

/** The exact rows + mapping a preview was computed from; commit replays it. */
interface PreviewedImport {
  rows: JsonRow[];
  mapping: ContactFieldMapping;
  preview: ContactsImportPreview;
}

export function ContactImportScreen({
  adapter,
  capabilities,
  navigation,
  className,
}: ContactImportScreenProps) {
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [mapping, setMapping] = useState<ContactFieldMapping>({});
  const [previewed, setPreviewed] = useState<PreviewedImport | null>(null);
  const [complete, setComplete] = useState<ContactsImportResult | null>(null);
  const parseOperation = useCrmOperation();
  const previewOperation = useCrmOperation();
  const commitOperation = useCrmOperation();
  /**
   * Bumped whenever the rows or the mapping change, so a preview that was in
   * flight for an older snapshot is dropped instead of describing rows the user
   * can no longer see.
   */
  const snapshot = useRef(0);

  function invalidate() {
    snapshot.current += 1;
    setPreviewed(null);
    setComplete(null);
  }

  async function parse(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    // A new file invalidates every downstream step.
    invalidate();
    setParsed(null);
    setMapping({});
    await parseOperation.start(() => adapter.parseImportFile(file), (result) => {
      const initial: ContactFieldMapping = {};
      for (const column of result.columns) initial[column] = "ignore";
      setParsed(result);
      setMapping(initial);
    });
  }

  function changeMapping(column: string, field: MappedField) {
    invalidate();
    setMapping((current) => ({ ...current, [column]: field }));
  }

  async function showPreview() {
    if (!parsed) return;
    const token = snapshot.current;
    const rows = parsed.rows;
    const requested = mapping;
    await previewOperation.start(
      () => adapter.previewImport(rows, requested),
      (preview) => {
        if (token !== snapshot.current) return;
        setPreviewed({ rows, mapping: requested, preview });
      },
    );
  }

  async function commit() {
    // `complete` is the guard against repeating a successful import of the same
    // snapshot; a failure leaves it null so the commit can be retried.
    if (!previewed || complete) return;
    const { rows, mapping: previewedMapping } = previewed;
    await commitOperation.start(
      () => adapter.importContacts({ rows, mapping: previewedMapping }),
      (result) => setComplete(result),
    );
  }

  if (!capabilities.import) {
    return (
      <main className={className}>
        <h1>Import contacts</h1>
        <p>You do not have permission to import contacts.</p>
        <button type="button" onClick={navigation.contacts}>
          Back to contacts
        </button>
      </main>
    );
  }

  return (
    <main className={className}>
      <h1>Import contacts</h1>
      <label>
        Contact file
        <input
          type="file"
          accept=".csv,.json"
          disabled={parseOperation.pending}
          onChange={(event) => void parse(event)}
        />
      </label>
      {parseOperation.error && (
        <ErrorNotice
          error={parseOperation.error}
          retryLabel="Retry parsing file"
          onRetry={parseOperation.retry}
        />
      )}

      {parsed && (
        <section>
          <h2>Map columns</h2>
          {parsed.columns.map((column) => (
            <label key={column}>
              Map {column}
              <select
                aria-label={`Map ${column}`}
                value={mapping[column] ?? "ignore"}
                onChange={(event) => changeMapping(column, event.target.value as MappedField)}
              >
                {FIELDS.map((field) => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            disabled={previewOperation.pending}
            onClick={() => void showPreview()}
          >
            Preview import
          </button>
        </section>
      )}
      {previewOperation.error && (
        <ErrorNotice
          error={previewOperation.error}
          retryLabel="Retry previewing import"
          onRetry={previewOperation.retry}
        />
      )}

      {previewed && (
        <section>
          <h2>Preview</h2>
          <p>
            {previewed.preview.valid} valid, {previewed.preview.invalid} invalid
          </p>
          {previewed.preview.errors.length > 0 && (
            <ul>
              {previewed.preview.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={commitOperation.pending || complete !== null || previewed.preview.valid === 0}
            onClick={() => void commit()}
          >
            Import contacts
          </button>
        </section>
      )}
      {commitOperation.error && (
        <ErrorNotice
          error={commitOperation.error}
          retryLabel="Retry importing contacts"
          onRetry={commitOperation.retry}
        />
      )}
      {complete && (
        <p>
          Imported {complete.imported}; skipped {complete.skipped}.
        </p>
      )}
      <button type="button" onClick={navigation.contacts}>
        Back to contacts
      </button>
    </main>
  );
}
