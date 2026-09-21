import { useMemo, useState, type ChangeEvent } from "react";
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

/** Stable JSON: arrays keep their order, object keys are sorted. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Snapshot identity derived from the data itself: the same rows and mapping
 * always produce the same key, so re-selecting an already imported payload is
 * recognized, while a genuinely different row payload is new.
 */
function snapshotFingerprint(rows: JsonRow[], mapping: ContactFieldMapping): string {
  return canonicalJson({ mapping, rows });
}

/** The exact rows + mapping a preview was computed from; commit replays it. */
interface PreviewedImport {
  rows: JsonRow[];
  mapping: ContactFieldMapping;
  fingerprint: string;
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
  /** Snapshots that already imported successfully, keyed by their own data. */
  const [imported, setImported] = useState<ReadonlySet<string>>(() => new Set());

  // The preview belongs to the current rows+mapping, the commit to the previewed
  // snapshot, and all three to the import capability. Changing any of them
  // retires the pending result, its error, and its retry instead of letting it
  // settle into the new flow.
  const currentFingerprint = useMemo(
    () => (parsed ? snapshotFingerprint(parsed.rows, mapping) : ""),
    [mapping, parsed],
  );
  const parseOperation = useCrmOperation(`parse:${capabilities.import}`);
  const previewOperation = useCrmOperation(`preview:${capabilities.import}:${currentFingerprint}`);
  const commitOperation = useCrmOperation(
    `commit:${capabilities.import}:${previewed?.fingerprint ?? ""}`,
  );
  const committing = commitOperation.pending;
  const alreadyImported = previewed ? imported.has(previewed.fingerprint) : false;

  async function parse(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    // A new file invalidates every downstream step. The imported record is
    // keyed by the data itself, so it deliberately survives: the same payload
    // can never be committed twice from this screen.
    setParsed(null);
    setMapping({});
    setPreviewed(null);
    setComplete(null);
    await parseOperation.start(() => adapter.parseImportFile(file), (result) => {
      const initial: ContactFieldMapping = {};
      for (const column of result.columns) initial[column] = "ignore";
      setParsed(result);
      setMapping(initial);
    });
  }

  function changeMapping(column: string, field: MappedField) {
    // The preview, its result, and its commit all describe the previous mapping.
    setPreviewed(null);
    setComplete(null);
    setMapping((current) => ({ ...current, [column]: field }));
  }

  async function showPreview() {
    if (!parsed) return;
    const rows = parsed.rows;
    const requested = mapping;
    const fingerprint = snapshotFingerprint(rows, requested);
    await previewOperation.start(
      () => adapter.previewImport(rows, requested),
      (preview) => setPreviewed({ rows, mapping: requested, fingerprint, preview }),
    );
  }

  async function commit() {
    // A successful snapshot is never importable twice, and a failure leaves
    // `complete` null so exactly that snapshot can be retried.
    if (!previewed || complete || imported.has(previewed.fingerprint)) return;
    const { rows, mapping: previewedMapping, fingerprint } = previewed;
    await commitOperation.start(
      () => adapter.importContacts({ rows, mapping: previewedMapping }),
      (result) => {
        setComplete(result);
        setImported((current) => new Set(current).add(fingerprint));
      },
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
          disabled={parseOperation.pending || committing}
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
                disabled={committing}
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
            disabled={previewOperation.pending || committing}
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
          {alreadyImported && !complete && <p>This file and mapping were already imported.</p>}
          <button
            type="button"
            disabled={
              committing || complete !== null || alreadyImported || previewed.preview.valid === 0
            }
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
