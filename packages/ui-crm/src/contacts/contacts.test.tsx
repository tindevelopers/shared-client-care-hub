// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CrmCapabilities, CrmNavigation, CrmUiResult } from "../index";
import {
  ContactDetailScreen,
  ContactFormScreen,
  ContactImportScreen,
  ContactsScreen,
  TagInput,
  type ContactDetailVm,
  type ContactPage,
  type ContactsAdapter,
} from "../contacts";

const capabilities: CrmCapabilities = {
  create: true,
  update: true,
  remove: true,
  import: true,
  bulkActions: true,
};

const navigation: CrmNavigation = {
  contacts: vi.fn(),
  contact: vi.fn(),
  editContact: vi.fn(),
  newContact: vi.fn(),
  importContacts: vi.fn(),
  lists: vi.fn(),
  list: vi.fn(),
  suppression: vi.fn(),
  campaigns: vi.fn(),
  campaign: vi.fn(),
  editCampaign: vi.fn(),
  newCampaign: vi.fn(),
  recipients: vi.fn(),
  analytics: vi.fn(),
};

const contact: ContactDetailVm = {
  id: "contact-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  phone: null,
  mobile: null,
  job_title: "Engineer",
  tags: ["vip"],
  sms_opt_out: false,
  email_opt_out: false,
  whatsapp_opt_out: false,
  updated_at: "2026-09-19T00:00:00Z",
  companyName: "Analytical Engines",
  company_id: null,
  department: null,
  address: null,
  avatar_url: null,
  custom_fields: null,
  notes: null,
  created_at: "2026-09-18T00:00:00Z",
  dnc: false,
};

const ok = <T,>(data: T): CrmUiResult<T> => ({ ok: true, data });

function adapter(overrides: Partial<ContactsAdapter> = {}): ContactsAdapter {
  return {
    listContacts: vi.fn(async () =>
      ok<ContactPage>({ items: [], total: 0, limit: 20, offset: 0 }),
    ),
    getContact: vi.fn(async () => ok(contact)),
    createContact: vi.fn(async () => ok(contact)),
    updateContact: vi.fn(async () => ok(contact)),
    deleteContact: vi.fn(async () => ok(undefined)),
    bulkDeleteContacts: vi.fn(async (ids) => ok({ deleted: ids.length })),
    assignTags: vi.fn(async (ids) => ok({ updated: ids.length })),
    listTags: vi.fn(async () => ok(["vip", "lead"])),
    listCompanyOptions: vi.fn(async () => ok([])),
    listActivities: vi.fn(async () => ok([])),
    listNotes: vi.fn(async () => ok([])),
    createNote: vi.fn(async (_id, content) =>
      ok({ id: "note-1", content, createdAt: "2026-09-19", createdByLabel: null }),
    ),
    parseImportFile: vi.fn(async () =>
      ok({ rows: [{ First: "Ada", Email: "ada@example.com" }], columns: ["First", "Email"] }),
    ),
    previewImport: vi.fn(async () => ok({ valid: 1, invalid: 0, errors: [] })),
    importContacts: vi.fn(async () => ok({ imported: 1, skipped: 0 })),
    ...overrides,
  };
}

describe("ContactsScreen", () => {
  it("renders empty and populated results", async () => {
    const empty = adapter();
    const view = render(
      <ContactsScreen adapter={empty} capabilities={capabilities} navigation={navigation} />,
    );
    expect(await screen.findByText("No contacts found.")).toBeInTheDocument();

    view.unmount();
    render(
      <ContactsScreen
        adapter={adapter({
          listContacts: vi.fn(async () =>
            ok({ items: [contact], total: 1, limit: 20, offset: 0 }),
          ),
        })}
        capabilities={capabilities}
        navigation={navigation}
      />,
    );
    expect(await screen.findByRole("cell", { name: "Ada Lovelace" })).toBeInTheDocument();
  });

  it("requests search, filter, and individual pages", async () => {
    const listContacts = vi.fn(async (query) =>
      ok<ContactPage>({ items: [contact], total: 45, limit: query?.limit ?? 20, offset: query?.offset ?? 0 }),
    );
    const source = adapter({ listContacts });
    const user = userEvent.setup();
    render(
      <ContactsScreen adapter={source} capabilities={capabilities} navigation={navigation} />,
    );
    await screen.findByRole("cell", { name: "Ada Lovelace" });

    await user.type(screen.getByRole("searchbox"), "Ada");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.selectOptions(screen.getByLabelText("Tag"), "vip");
    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(listContacts).toHaveBeenCalledWith(expect.objectContaining({ search: "Ada" }));
    expect(listContacts).toHaveBeenCalledWith(expect.objectContaining({ tag: "vip" }));
    expect(listContacts).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 20, offset: 20 }),
    );
  });

  it("hides unauthorized bulk actions", async () => {
    render(
      <ContactsScreen
        adapter={adapter({
          listContacts: vi.fn(async () =>
            ok({ items: [contact], total: 1, limit: 20, offset: 0 }),
          ),
        })}
        capabilities={{ ...capabilities, bulkActions: false, remove: false }}
        navigation={navigation}
      />,
    );
    await screen.findByRole("cell", { name: "Ada Lovelace" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete selected" })).not.toBeInTheDocument();
  });

  it("offers retry only for retryable errors", async () => {
    const retryable = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: "busy", message: "Try again", retryable: true } })
      .mockResolvedValueOnce(ok({ items: [], total: 0, limit: 20, offset: 0 }));
    const view = render(
      <ContactsScreen
        adapter={adapter({ listContacts: retryable })}
        capabilities={capabilities}
        navigation={navigation}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(retryable).toHaveBeenCalledTimes(2);

    view.unmount();
    render(
      <ContactsScreen
        adapter={adapter({
          listContacts: vi.fn(async () => ({
            ok: false,
            error: { code: "denied", message: "Denied", retryable: false },
          })),
        })}
        capabilities={capabilities}
        navigation={navigation}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Denied");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("contact editing", () => {
  it("validates create and update submissions", async () => {
    const createContact = vi.fn(async () => ok(contact));
    const user = userEvent.setup();
    render(
      <ContactFormScreen
        adapter={adapter({ createContact })}
        capabilities={capabilities}
        navigation={navigation}
        mode="create"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Create contact" }));
    expect(screen.getByRole("alert")).toHaveTextContent("First and last name are required.");
    expect(createContact).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.type(screen.getByLabelText("Last name"), "Lovelace");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Create contact" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
  });

  it("does not submit an invalid update", async () => {
    const updateContact = vi.fn(async () => ok(contact));
    const user = userEvent.setup();
    render(
      <ContactFormScreen
        adapter={adapter({ updateContact })}
        capabilities={capabilities}
        navigation={navigation}
        mode="edit"
        contactId="contact-1"
      />,
    );
    const lastName = await screen.findByLabelText("Last name");
    await user.clear(lastName);
    await user.click(screen.getByRole("button", { name: "Save contact" }));
    expect(screen.getByRole("alert")).toHaveTextContent("First and last name are required.");
    expect(updateContact).not.toHaveBeenCalled();
  });

  it("adds and removes tags with the keyboard", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TagInput value={["vip"]} onChange={onChange} label="Tags" />);
    const input = screen.getByLabelText("Tags");
    await user.type(input, "lead{Enter}");
    expect(onChange).toHaveBeenCalledWith(["vip", "lead"]);
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("renders host quick actions", async () => {
    render(
      <ContactDetailScreen
        adapter={adapter()}
        capabilities={capabilities}
        navigation={navigation}
        contactId="contact-1"
        quickActions={<button>Call from host</button>}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call from host" })).toBeInTheDocument();
  });
});

describe("ContactImportScreen", () => {
  it("parses, maps, previews, and commits an import", async () => {
    const source = adapter();
    const user = userEvent.setup();
    render(
      <ContactImportScreen adapter={source} capabilities={capabilities} navigation={navigation} />,
    );
    const file = new File(["First,Email\nAda,ada@example.com"], "contacts.csv", {
      type: "text/csv",
    });
    await user.upload(screen.getByLabelText("Contact file"), file);
    expect(await screen.findByRole("heading", { name: "Map columns" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Map First"), "first_name");
    await user.selectOptions(screen.getByLabelText("Map Email"), "email");
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText("1 valid, 0 invalid")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import contacts" }));

    await waitFor(() => expect(source.importContacts).toHaveBeenCalledWith({
      rows: [{ First: "Ada", Email: "ada@example.com" }],
      mapping: { First: "first_name", Email: "email" },
    }));
    expect(await screen.findByText("Imported 1; skipped 0.")).toBeInTheDocument();
  });
});
