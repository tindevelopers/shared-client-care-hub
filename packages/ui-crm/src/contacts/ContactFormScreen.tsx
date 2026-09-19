import { useEffect, useState, type FormEvent } from "react";
import type { CrmUiError } from "../core/result.js";
import type { ContactFormScreenProps } from "./adapter.js";
import { TagInput } from "./TagInput.js";
import type { ContactInput } from "./types.js";

const EMPTY_INPUT: ContactInput = { first_name: "", last_name: "", email: "", tags: [] };

export function ContactFormScreen({
  adapter,
  capabilities,
  navigation,
  mode,
  contactId,
  className,
}: ContactFormScreenProps) {
  const [input, setInput] = useState<ContactInput>(EMPTY_INPUT);
  const [error, setError] = useState<CrmUiError | null>(null);
  const allowed = mode === "create" ? capabilities.create : capabilities.update;

  useEffect(() => {
    if (mode !== "edit" || !contactId) return;
    void adapter.getContact(contactId).then((result) => {
      if (!result.ok) setError(result.error);
      else if (!result.data) {
        setError({ code: "not_found", message: "Contact not found.", retryable: false });
      } else {
        const contact = result.data;
        setInput({
          first_name: contact.first_name,
          last_name: contact.last_name,
          company_id: contact.company_id,
          email: contact.email,
          phone: contact.phone,
          mobile: contact.mobile,
          job_title: contact.job_title,
          department: contact.department,
          tags: contact.tags,
          notes: contact.notes,
        });
      }
    });
  }, [adapter, contactId, mode]);

  function update<K extends keyof ContactInput>(key: K, value: ContactInput[K]) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!input.first_name.trim() || !input.last_name.trim()) {
      setError({
        code: "validation",
        message: "First and last name are required.",
        retryable: false,
      });
      return;
    }
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      setError({
        code: "validation",
        message: "Enter a valid email address.",
        retryable: false,
      });
      return;
    }
    if (!allowed) return;
    const result =
      mode === "create"
        ? await adapter.createContact(input)
        : await adapter.updateContact(contactId ?? "", input);
    if (!result.ok) setError(result.error);
    else navigation.contact(result.data.id);
  }

  return (
    <main className={className}>
      <h1>{mode === "create" ? "New contact" : "Edit contact"}</h1>
      {error && <p role="alert">{error.message}</p>}
      <form noValidate onSubmit={submit}>
        <label>
          First name
          <input
            value={input.first_name}
            disabled={!allowed}
            onChange={(event) => update("first_name", event.target.value)}
          />
        </label>
        <label>
          Last name
          <input
            value={input.last_name}
            disabled={!allowed}
            onChange={(event) => update("last_name", event.target.value)}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={input.email ?? ""}
            disabled={!allowed}
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
          <button type="submit">{mode === "create" ? "Create contact" : "Save contact"}</button>
        )}
        <button type="button" onClick={navigation.contacts}>
          Cancel
        </button>
      </form>
    </main>
  );
}
