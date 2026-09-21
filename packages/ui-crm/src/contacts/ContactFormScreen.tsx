import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CrmUiError } from "../core/result.js";
import type { ContactFormScreenProps } from "./adapter.js";
import { ErrorNotice } from "./ErrorNotice.js";
import { TagInput } from "./TagInput.js";
import { useCrmOperation } from "./useCrmOperation.js";
import type { ContactDetailVm, ContactInput } from "./types.js";

const EMPTY_INPUT: ContactInput = { first_name: "", last_name: "", tags: [] };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORM_ERROR_ID = "contact-form-error";

type InvalidFields = Partial<Record<keyof ContactInput, boolean>>;

/** Optional text columns are trimmed and sent as `null`, never as `""`. */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The payload shape both create and update send: every optional field normalized. */
function toContactInput(form: ContactInput): ContactInput {
  return {
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    company_id: form.company_id ?? null,
    email: optionalText(form.email),
    phone: optionalText(form.phone),
    mobile: optionalText(form.mobile),
    job_title: optionalText(form.job_title),
    department: optionalText(form.department),
    avatar_url: optionalText(form.avatar_url),
    address: form.address ?? null,
    custom_fields: form.custom_fields ?? null,
    notes: optionalText(form.notes),
    tags: form.tags ?? [],
  };
}

/** Loaded contact → editable form state (text controls bind strings, not null). */
function toFormState(contact: ContactDetailVm): ContactInput {
  return {
    first_name: contact.first_name,
    last_name: contact.last_name,
    company_id: contact.company_id,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    mobile: contact.mobile ?? "",
    job_title: contact.job_title ?? "",
    department: contact.department ?? "",
    avatar_url: contact.avatar_url ?? "",
    address: contact.address,
    custom_fields: contact.custom_fields,
    notes: contact.notes ?? "",
    tags: contact.tags ?? [],
  };
}

export function ContactFormScreen({
  adapter,
  capabilities,
  navigation,
  mode,
  contactId,
  className,
}: ContactFormScreenProps) {
  const [input, setInput] = useState<ContactInput | null>(
    mode === "create" ? EMPTY_INPUT : null,
  );
  /** The contact id `input` was loaded from; the form stays closed until it matches. */
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<InvalidFields>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<CrmUiError | null>(null);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [companiesUnavailable, setCompaniesUnavailable] = useState(false);
  const saveOperation = useCrmOperation();
  /** Identity of the in-flight edit load; superseded responses are dropped. */
  const request = useRef(0);

  const allowed = mode === "create" ? capabilities.create : capabilities.update;
  const missingId = mode === "edit" && !contactId;
  const ready = input !== null && (mode === "create" || loadedId === contactId);

  const load = useCallback(async () => {
    if (mode !== "edit" || !contactId) return;
    const token = ++request.current;
    // Close the form until the load that matches this id arrives, so typing can
    // never race it and a late response can never overwrite edits.
    setInput(null);
    setLoadedId(null);
    setLoadError(null);
    const result = await adapter.getContact(contactId);
    if (token !== request.current) return;
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    if (!result.data) {
      setLoadError({ code: "not_found", message: "Contact not found.", retryable: false });
      return;
    }
    setInput(toFormState(result.data));
    setLoadedId(contactId);
  }, [adapter, contactId, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    void adapter.listCompanyOptions().then((result) => {
      if (!active) return;
      if (result.ok) setCompanies(result.data);
      else setCompaniesUnavailable(true);
    });
    return () => {
      active = false;
    };
  }, [adapter]);

  function update<K extends keyof ContactInput>(key: K, value: ContactInput[K]) {
    setInput((current) => (current ? { ...current, [key]: value } : current));
    if (!invalid[key]) return;
    const next = { ...invalid, [key]: false };
    setInvalid(next);
    // Clear the stale validation alert once no marked field is invalid.
    if (!Object.values(next).some(Boolean)) setValidationError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input || !allowed || !ready) return;
    if (mode === "edit" && !contactId) return;

    const email = optionalText(input.email);
    const firstNameInvalid = !input.first_name.trim();
    const lastNameInvalid = !input.last_name.trim();
    if (firstNameInvalid || lastNameInvalid) {
      setInvalid({ first_name: firstNameInvalid, last_name: lastNameInvalid });
      setValidationError("First and last name are required.");
      return;
    }
    if (email !== null && !EMAIL_PATTERN.test(email)) {
      setInvalid({ email: true });
      setValidationError("Enter a valid email address.");
      return;
    }
    setInvalid({});
    setValidationError(null);

    const payload = toContactInput(input);
    const targetId = contactId ?? "";
    await saveOperation.start(
      () =>
        mode === "create"
          ? adapter.createContact(payload)
          : adapter.updateContact(targetId, payload),
      (saved) => navigation.contact(saved.id),
    );
  }

  function invalidProps(key: keyof ContactInput) {
    return {
      "aria-invalid": invalid[key] ? true : undefined,
      "aria-describedby": invalid[key] ? FORM_ERROR_ID : undefined,
    };
  }

  return (
    <main className={className}>
      <h1>{mode === "create" ? "New contact" : "Edit contact"}</h1>
      {missingId && <p role="alert">A contact id is required to edit a contact.</p>}
      {loadError && (
        <ErrorNotice
          error={loadError}
          retryLabel="Retry loading contact"
          onRetry={() => void load()}
        />
      )}
      {!missingId && !ready && !loadError && <p role="status">Loading contact…</p>}
      {!missingId && ready && input && (
        <>
          {validationError && (
            <p role="alert" id={FORM_ERROR_ID}>
              {validationError}
            </p>
          )}
          {saveOperation.error && (
            <ErrorNotice
              error={saveOperation.error}
              retryLabel={mode === "create" ? "Retry creating contact" : "Retry saving contact"}
              onRetry={saveOperation.retry}
            />
          )}
          <form noValidate onSubmit={submit}>
            <label>
              First name
              <input
                value={input.first_name}
                disabled={!allowed}
                {...invalidProps("first_name")}
                onChange={(event) => update("first_name", event.target.value)}
              />
            </label>
            <label>
              Last name
              <input
                value={input.last_name}
                disabled={!allowed}
                {...invalidProps("last_name")}
                onChange={(event) => update("last_name", event.target.value)}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={input.email ?? ""}
                disabled={!allowed}
                {...invalidProps("email")}
                onChange={(event) => update("email", event.target.value || null)}
              />
            </label>
            <label>
              Phone
              <input
                type="tel"
                value={input.phone ?? ""}
                disabled={!allowed}
                onChange={(event) => update("phone", event.target.value || null)}
              />
            </label>
            <label>
              Mobile
              <input
                type="tel"
                value={input.mobile ?? ""}
                disabled={!allowed}
                onChange={(event) => update("mobile", event.target.value || null)}
              />
            </label>
            <label>
              Job title
              <input
                value={input.job_title ?? ""}
                disabled={!allowed}
                onChange={(event) => update("job_title", event.target.value || null)}
              />
            </label>
            <label>
              Department
              <input
                value={input.department ?? ""}
                disabled={!allowed}
                onChange={(event) => update("department", event.target.value || null)}
              />
            </label>
            <label>
              Company
              <select
                value={input.company_id ?? ""}
                disabled={!allowed}
                onChange={(event) => update("company_id", event.target.value || null)}
              >
                <option value="">No company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
            {companiesUnavailable && <p role="status">Company options unavailable.</p>}
            <TagInput
              value={input.tags ?? []}
              onChange={(tags) => update("tags", tags)}
              disabled={!allowed}
            />
            <label>
              Notes
              <textarea
                value={input.notes ?? ""}
                disabled={!allowed}
                onChange={(event) => update("notes", event.target.value || null)}
              />
            </label>
            {allowed && (
              <button type="submit" disabled={saveOperation.pending}>
                {mode === "create" ? "Create contact" : "Save contact"}
              </button>
            )}
            <button type="button" onClick={navigation.contacts}>
              Cancel
            </button>
          </form>
        </>
      )}
    </main>
  );
}
