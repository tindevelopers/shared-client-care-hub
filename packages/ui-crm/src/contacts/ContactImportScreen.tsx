import { useState, type ChangeEvent } from "react";
import type { CrmUiError } from "../core/result.js";
import type { ContactImportScreenProps } from "./adapter.js";
import type {
  ContactFieldMapping,
  ContactsImportPreview,
  ContactsImportResult,
  ParsedImport,
} from "./types.js";

const FIELDS: Array<{ value: ContactFieldMapping[string]; label: string }> = [
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

export function ContactImportScreen({
  adapter,
  capabilities,
  navigation,
  className,
}: ContactImportScreenProps) {
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [mapping, setMapping] = useState<ContactFieldMapping>({});
  const [preview, setPreview] = useState<ContactsImportPreview | null>(null);
  const [complete, setComplete] = useState<ContactsImportResult | null>(null);
  const [error, setError] = useState<CrmUiError | null>(null);

  async function parse(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setPreview(null);
    setComplete(null);
    const result = await adapter.parseImportFile(file);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setParsed(result.data);
    setMapping(Object.fromEntries(result.data.columns.map((column) => [column, "ignore"])));
  }

  async function showPreview() {
    if (!parsed) return;
    const result = await adapter.previewImport(parsed.rows, mapping);
    if (!result.ok) setError(result.error);
    else setPreview(result.data);
  }

  async function commit() {
    if (!parsed || !preview) return;
    const result = await adapter.importContacts({ rows: parsed.rows, mapping });
    if (!result.ok) setError(result.error);
    else setComplete(result.data);
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
      {error && (
        <div role="alert">
          <p>{error.message}</p>
        </div>
      )}
      <label>
        Contact file
        <input type="file" accept=".csv,.json" onChange={parse} />
      </label>
      {parsed && (
        <section>
          <h2>Map columns</h2>
          {parsed.columns.map((column) => (
            <label key={column}>
              Map {column}
              <select
                aria-label={`Map ${column}`}
                value={mapping[column] ?? "ignore"}
                onChange={(event) => {
                  setPreview(null);
                  setMapping((current) => ({
                    ...current,
                    [column]: event.target.value as ContactFieldMapping[string],
                  }));
                }}
              >
                {FIELDS.map((field) => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button type="button" onClick={showPreview}>
            Preview import
          </button>
        </section>
      )}
      {preview && (
        <section>
          <h2>Preview</h2>
          <p>
            {preview.valid} valid, {preview.invalid} invalid
          </p>
          {preview.errors.length > 0 && (
            <ul>
              {preview.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          <button type="button" disabled={preview.valid === 0} onClick={commit}>
            Import contacts
          </button>
        </section>
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
