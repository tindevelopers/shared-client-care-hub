// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
  type ContactsImportResult,
  type NoteVm,
  type ParsedImport,
} from "../contacts";

const ALL_CAPABILITIES: CrmCapabilities = {
  create: true,
  update: true,
  remove: true,
  import: true,
  bulkActions: true,
};

function navigation(): CrmNavigation {
  return {
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
}

const ada: ContactDetailVm = {
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

const grace: ContactDetailVm = {
  ...ada,
  id: "contact-2",
  first_name: "Grace",
  last_name: "Hopper",
  email: "grace@example.com",
  companyName: "Navy",
};

const note: NoteVm = {
  id: "note-1",
  content: "Existing note",
  createdAt: "2026-09-18T00:00:00Z",
  createdByLabel: null,
};

const parsedA: ParsedImport = {
  rows: [{ First: "Ada", Email: "ada@example.com" }],
  columns: ["First", "Email"],
};

const parsedB: ParsedImport = { rows: [{ Name: "Grace" }], columns: ["Name"] };

function ok<T>(data: T): CrmUiResult<T> {
  return { ok: true, data };
}

function failure<T = never>(message: string, retryable: boolean): CrmUiResult<T> {
  return { ok: false, error: { code: retryable ? "retryable" : "fatal", message, retryable } };
}

function pageOf(items: ContactDetailVm[], total = items.length, offset = 0): ContactPage {
  return { items, total, limit: 20, offset };
}

/** Settles only when the test says so — the basis of every stale-request test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function adapter(overrides: Partial<ContactsAdapter> = {}): ContactsAdapter {
  return {
    listContacts: vi.fn(async () => ok(pageOf([]))),
    getContact: vi.fn(async () => ok(ada)),
    createContact: vi.fn(async () => ok(ada)),
    updateContact: vi.fn(async () => ok(ada)),
    deleteContact: vi.fn(async () => ok(undefined)),
    bulkDeleteContacts: vi.fn(async (ids: string[]) => ok({ deleted: ids.length })),
    assignTags: vi.fn(async (ids: string[]) => ok({ updated: ids.length })),
    listTags: vi.fn(async () => ok(["vip", "lead"])),
    listCompanyOptions: vi.fn(async () => ok([])),
    listActivities: vi.fn(async () => ok([])),
    listNotes: vi.fn(async () => ok([])),
    createNote: vi.fn(async (_id: string, content: string) =>
      ok<NoteVm>({ id: "note-2", content, createdAt: "2026-09-19T00:00:00Z", createdByLabel: null }),
    ),
    parseImportFile: vi.fn(async () => ok(parsedA)),
    previewImport: vi.fn(async () => ok({ valid: 1, invalid: 0, errors: [] })),
    importContacts: vi.fn(async () => ok<ContactsImportResult>({ imported: 1, skipped: 0 })),
    ...overrides,
  };
}

describe("ContactsScreen", () => {
  it("renders empty and populated results", async () => {
    const view = render(
      <ContactsScreen
        adapter={adapter()}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    expect(await screen.findByText("No contacts found.")).toBeInTheDocument();

    view.unmount();
    render(
      <ContactsScreen
        adapter={adapter({ listContacts: vi.fn(async () => ok(pageOf([ada]))) })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    expect(await screen.findByRole("cell", { name: "Ada Lovelace" })).toBeInTheDocument();
  });

  it("requests search, filter, and individual pages", async () => {
    const listContacts = vi.fn(async (query?: { limit: number; offset: number }) =>
      ok(pageOf([ada], 45, query?.offset ?? 0)),
    );
    const source = adapter({ listContacts });
    const user = userEvent.setup();
    render(
      <ContactsScreen adapter={source} capabilities={ALL_CAPABILITIES} navigation={navigation()} />,
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
        adapter={adapter({ listContacts: vi.fn(async () => ok(pageOf([ada]))) })}
        capabilities={{ ...ALL_CAPABILITIES, bulkActions: false, remove: false }}
        navigation={navigation()}
      />,
    );
    await screen.findByRole("cell", { name: "Ada Lovelace" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete selected" })).not.toBeInTheDocument();
  });

  it("hides bulk tag writes without the update capability", async () => {
    render(
      <ContactsScreen
        adapter={adapter({ listContacts: vi.fn(async () => ok(pageOf([ada]))) })}
        capabilities={{ ...ALL_CAPABILITIES, update: false }}
        navigation={navigation()}
      />,
    );
    await screen.findByRole("cell", { name: "Ada Lovelace" });
    expect(screen.getByRole("checkbox", { name: "Select Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign tag" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tag selected")).not.toBeInTheDocument();
  });

  it("offers retry only for retryable load errors and reloads the same query", async () => {
    const listContacts = vi
      .fn<Parameters<ContactsAdapter["listContacts"]>, ReturnType<ContactsAdapter["listContacts"]>>()
      .mockResolvedValueOnce(ok(pageOf([ada])))
      .mockResolvedValueOnce(failure("Try again", true))
      .mockResolvedValue(ok(pageOf([ada])));
    const user = userEvent.setup();
    const view = render(
      <ContactsScreen
        adapter={adapter({ listContacts })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    await screen.findByRole("cell", { name: "Ada Lovelace" });
    await user.type(screen.getByRole("searchbox"), "Ada");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await user.click(await screen.findByRole("button", { name: "Retry loading contacts" }));
    await waitFor(() => expect(listContacts).toHaveBeenCalledTimes(3));
    // The retry replays the load operation with the query it failed on.
    expect(listContacts.mock.calls[1][0]).toEqual(listContacts.mock.calls[2][0]);
    expect(listContacts.mock.calls[2][0]).toEqual(
      expect.objectContaining({ search: "Ada", limit: 20, offset: 0 }),
    );

    view.unmount();
    render(
      <ContactsScreen
        adapter={adapter({
          listContacts: vi.fn(async () => failure("Denied", false)),
        })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Denied");
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });

  it("discards a stale list response instead of overwriting the newer page", async () => {
    const firstLoad = deferred<CrmUiResult<ContactPage>>();
    const listContacts = vi
      .fn<Parameters<ContactsAdapter["listContacts"]>, ReturnType<ContactsAdapter["listContacts"]>>()
      .mockReturnValueOnce(firstLoad.promise)
      .mockResolvedValue(ok(pageOf([grace], 1)));
    const user = userEvent.setup();
    render(
      <ContactsScreen
        adapter={adapter({ listContacts })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Loading contacts…");

    // A newer query supersedes the in-flight one and resolves first.
    await user.type(screen.getByRole("searchbox"), "Grace");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("cell", { name: "Grace Hopper" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // The superseded response arrives late and must be dropped entirely.
    await act(async () => {
      firstLoad.resolve(ok(pageOf([ada], 99)));
    });
    expect(screen.queryByRole("cell", { name: "Ada Lovelace" })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Grace Hopper" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clears a failed page instead of showing rows from another query", async () => {
    const listContacts = vi
      .fn<Parameters<ContactsAdapter["listContacts"]>, ReturnType<ContactsAdapter["listContacts"]>>()
      .mockResolvedValueOnce(ok(pageOf([ada])))
      .mockResolvedValue(failure("Denied", false));
    const user = userEvent.setup();
    render(
      <ContactsScreen
        adapter={adapter({ listContacts })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    await screen.findByRole("cell", { name: "Ada Lovelace" });

    await user.type(screen.getByRole("searchbox"), "nobody");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Denied");
    expect(screen.queryByRole("cell", { name: "Ada Lovelace" })).not.toBeInTheDocument();
  });

  it("clears the selection when the query changes", async () => {
    const source = adapter({
      listContacts: vi.fn(async () => ok(pageOf([ada, grace], 45))),
    });
    const user = userEvent.setup();
    render(
      <ContactsScreen adapter={source} capabilities={ALL_CAPABILITIES} navigation={navigation()} />,
    );
    await screen.findByRole("cell", { name: "Ada Lovelace" });

    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox"), "Grace");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Select Ada Lovelace" })).not.toBeChecked();
    expect(source.bulkDeleteContacts).not.toHaveBeenCalled();
  });

  it("deletes selected contacts through a modal confirmation", async () => {
    const source = adapter({ listContacts: vi.fn(async () => ok(pageOf([ada], 45))) });
    const user = userEvent.setup();
    render(
      <ContactsScreen adapter={source} capabilities={ALL_CAPABILITIES} navigation={navigation()} />,
    );
    await screen.findByRole("cell", { name: "Ada Lovelace" });
    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));

    // Modal semantics: focus starts on the non-destructive action, nothing is deleted yet.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(source.bulkDeleteContacts).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(source.bulkDeleteContacts).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete selected" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(source.bulkDeleteContacts).toHaveBeenCalledWith(["contact-1"]));
  });

  it("retries a failed bulk delete with the same ids and never reloads in its place", async () => {
    const secondDelete = deferred<CrmUiResult<{ deleted: number }>>();
    const bulkDeleteContacts = vi
      .fn<
        Parameters<ContactsAdapter["bulkDeleteContacts"]>,
        ReturnType<ContactsAdapter["bulkDeleteContacts"]>
      >()
      .mockResolvedValueOnce(failure("Try again", true))
      .mockReturnValueOnce(secondDelete.promise);
    const listContacts = vi.fn(async () => ok(pageOf([ada], 45)));
    const source = adapter({ bulkDeleteContacts, listContacts });
    const user = userEvent.setup();
    render(
      <ContactsScreen adapter={source} capabilities={ALL_CAPABILITIES} navigation={navigation()} />,
    );
    await screen.findByRole("cell", { name: "Ada Lovelace" });
    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    await user.click(screen.getByRole("button", { name: "Retry deleting selected contacts" }));

    // The retry replays the mutation with the ids it failed on; the list load
    // is not the retry path.
    await waitFor(() => expect(bulkDeleteContacts).toHaveBeenCalledTimes(2));
    expect(bulkDeleteContacts).toHaveBeenNthCalledWith(2, ["contact-1"]);
    expect(listContacts).toHaveBeenCalledTimes(1);

    await act(async () => {
      secondDelete.resolve(ok({ deleted: 1 }));
    });
    await waitFor(() => expect(listContacts).toHaveBeenCalledTimes(2));
  });

  it("assigns a tag to the selected contacts", async () => {
    const source = adapter({ listContacts: vi.fn(async () => ok(pageOf([ada], 45))) });
    const user = userEvent.setup();
    render(
      <ContactsScreen adapter={source} capabilities={ALL_CAPABILITIES} navigation={navigation()} />,
    );
    await screen.findByRole("cell", { name: "Ada Lovelace" });
    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
    await user.type(screen.getByLabelText("Tag selected"), "vip");
    await user.click(screen.getByRole("button", { name: "Assign tag" }));

    await waitFor(() => expect(source.assignTags).toHaveBeenCalledWith(["contact-1"], ["vip"]));
    await waitFor(() => expect(screen.getByLabelText("Tag selected")).toHaveValue(""));
  });
});

describe("ContactFormScreen", () => {
  it("validates create submissions and marks the invalid controls", async () => {
    const createContact = vi.fn(async () => ok(ada));
    const user = userEvent.setup();
    render(
      <ContactFormScreen
        adapter={adapter({ createContact })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        mode="create"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create contact" }));
    expect(screen.getByRole("alert")).toHaveTextContent("First and last name are required.");
    expect(createContact).not.toHaveBeenCalled();
    expect(screen.getByLabelText("First name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Last name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("First name")).toHaveAttribute(
      "aria-describedby",
      "contact-form-error",
    );

    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.type(screen.getByLabelText("Last name"), "Lovelace");
    // The stale validation alert is cleared once the invalid fields are fixed.
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByLabelText("First name")).not.toHaveAttribute("aria-invalid");

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Create contact" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(createContact).not.toHaveBeenCalled();
  });

  it("does not submit an invalid update", async () => {
    const updateContact = vi.fn(async () => ok(ada));
    const user = userEvent.setup();
    render(
      <ContactFormScreen
        adapter={adapter({ updateContact })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        mode="edit"
        contactId="contact-1"
      />,
    );
    await user.clear(await screen.findByLabelText("Last name"));
    await user.click(screen.getByRole("button", { name: "Save contact" }));
    expect(screen.getByRole("alert")).toHaveTextContent("First and last name are required.");
    expect(updateContact).not.toHaveBeenCalled();
  });

  it("keeps the edit form closed until the matching contact has loaded", async () => {
    const load = deferred<CrmUiResult<ContactDetailVm | null>>();
    const getContact = vi
      .fn<Parameters<ContactsAdapter["getContact"]>, ReturnType<ContactsAdapter["getContact"]>>()
      .mockReturnValue(load.promise);
    render(
      <ContactFormScreen
        adapter={adapter({ getContact })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        mode="edit"
        contactId="contact-1"
      />,
    );

    // Nothing is writable before the load that matches this contact id.
    expect(screen.queryByLabelText("Last name")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading contact…");

    await act(async () => {
      load.resolve(ok(ada));
    });
    expect(await screen.findByLabelText("Last name")).toHaveValue("Lovelace");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ignores a late load for a superseded contact id", async () => {
    const slowAda = deferred<CrmUiResult<ContactDetailVm | null>>();
    const getContact = vi
      .fn<Parameters<ContactsAdapter["getContact"]>, ReturnType<ContactsAdapter["getContact"]>>()
      .mockReturnValueOnce(slowAda.promise)
      .mockResolvedValue(ok(grace));
    const source = adapter({ getContact });
    const view = render(
      <ContactFormScreen
        adapter={source}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        mode="edit"
        contactId="contact-1"
      />,
    );
    expect(screen.queryByLabelText("Last name")).not.toBeInTheDocument();

    view.rerender(
      <ContactFormScreen
        adapter={source}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        mode="edit"
        contactId="contact-2"
      />,
    );
    expect(await screen.findByLabelText("Last name")).toHaveValue("Hopper");

    // The stale response must not overwrite the edits of the visible contact.
    await act(async () => {
      slowAda.resolve(ok(ada));
    });
    expect(screen.getByLabelText("Last name")).toHaveValue("Hopper");
    expect(screen.getByLabelText("First name")).toHaveValue("Grace");
  });

  it("reports a missing edit id and never submits without one", async () => {
    const updateContact = vi.fn(async () => ok(ada));
    render(
      <ContactFormScreen
        adapter={adapter({ updateContact })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        mode="edit"
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A contact id is required to edit a contact.",
    );
    expect(screen.queryByRole("button", { name: "Save contact" })).not.toBeInTheDocument();
    expect(updateContact).not.toHaveBeenCalled();
  });

  it("normalizes optional fields and never sends an empty email", async () => {
    const createContact = vi.fn(async () => ok(ada));
    const user = userEvent.setup();
    render(
      <ContactFormScreen
        adapter={adapter({ createContact })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        mode="create"
      />,
    );
    await user.type(screen.getByLabelText("First name"), " Ada ");
    await user.type(screen.getByLabelText("Last name"), " Lovelace ");
    await user.type(screen.getByLabelText("Phone"), "+1 555 0100");
    await user.type(screen.getByLabelText("Notes"), "   ");
    await user.click(screen.getByRole("button", { name: "Create contact" }));

    await waitFor(() =>
      expect(createContact).toHaveBeenCalledWith({
        first_name: "Ada",
        last_name: "Lovelace",
        company_id: null,
        email: null,
        phone: "+1 555 0100",
        mobile: null,
        job_title: null,
        department: null,
        avatar_url: null,
        address: null,
        custom_fields: null,
        notes: null,
        tags: [],
      }),
    );
  });

  it("loads, renders, and clears company options", async () => {
    const createContact = vi.fn(async () => ok(ada));
    const user = userEvent.setup();
    render(
      <ContactFormScreen
        adapter={
          adapter({
            createContact,
            listCompanyOptions: vi.fn(async () =>
              ok([{ id: "company-1", name: "Analytical Engines" }]),
            ),
          })
        }
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        mode="create"
      />,
    );

    const company = await screen.findByLabelText("Company");
    expect(company).toHaveValue("");
    await user.selectOptions(company, "company-1");
    expect(company).toHaveValue("company-1");

    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.type(screen.getByLabelText("Last name"), "Lovelace");
    await user.click(screen.getByRole("button", { name: "Create contact" }));
    await waitFor(() =>
      expect(createContact).toHaveBeenCalledWith(
        expect.objectContaining({ company_id: "company-1" }),
      ),
    );

    // Clearing is an explicit null, not an empty string.
    await user.selectOptions(company, "");
    await user.click(screen.getByRole("button", { name: "Create contact" }));
    await waitFor(() =>
      expect(createContact).toHaveBeenLastCalledWith(expect.objectContaining({ company_id: null })),
    );
  });

  it("keeps the form usable when company options fail to load", async () => {
    const user = userEvent.setup();
    render(
      <ContactFormScreen
        adapter={
          adapter({ listCompanyOptions: vi.fn(async () => failure("Denied", false)) })
        }
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        mode="create"
      />,
    );
    expect(await screen.findByText("Company options unavailable.")).toBeInTheDocument();
    expect(screen.getByLabelText("Company")).toBeInTheDocument();
    await user.type(screen.getByLabelText("First name"), "Ada");
    expect(screen.getByLabelText("First name")).toHaveValue("Ada");
  });

  it("submits once, disables while saving, and retries only the save", async () => {
    const save = deferred<CrmUiResult<ContactDetailVm>>();
    const createContact = vi
      .fn<Parameters<ContactsAdapter["createContact"]>, ReturnType<ContactsAdapter["createContact"]>>()
      .mockReturnValueOnce(save.promise)
      .mockResolvedValue(failure("Try again", true));
    const user = userEvent.setup();
    render(
      <ContactFormScreen
        adapter={adapter({ createContact })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        mode="create"
      />,
    );
    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.type(screen.getByLabelText("Last name"), "Lovelace");

    const submit = screen.getByRole("button", { name: "Create contact" });
    await user.click(submit);
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(createContact).toHaveBeenCalledTimes(1);

    await act(async () => {
      save.resolve(failure("Try again", true));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    await user.click(screen.getByRole("button", { name: "Retry creating contact" }));
    await waitFor(() => expect(createContact).toHaveBeenCalledTimes(2));
    expect(createContact).toHaveBeenNthCalledWith(2, createContact.mock.calls[0][0]);
  });

  it("navigates to the saved contact after a successful create", async () => {
    const routes = navigation();
    const user = userEvent.setup();
    render(
      <ContactFormScreen
        adapter={adapter()}
        capabilities={ALL_CAPABILITIES}
        navigation={routes}
        mode="create"
      />,
    );
    await user.type(screen.getByLabelText("First name"), "Ada");
    await user.type(screen.getByLabelText("Last name"), "Lovelace");
    await user.click(screen.getByRole("button", { name: "Create contact" }));
    await waitFor(() => expect(routes.contact).toHaveBeenCalledWith("contact-1"));
  });
});

describe("TagInput", () => {
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

  it("stays in sync with a stateful host", async () => {
    function Host() {
      const [tags, setTags] = useState<string[]>(["vip"]);
      return <TagInput value={tags} onChange={setTags} label="Tags" />;
    }
    const user = userEvent.setup();
    render(<Host />);

    const input = screen.getByLabelText("Tags");
    await user.type(input, "lead{Enter}");
    expect(screen.getByRole("list", { name: "Tags selected" })).toHaveTextContent("vip");
    expect(screen.getByRole("list", { name: "Tags selected" })).toHaveTextContent("lead");
    expect(input).toHaveValue("");

    // Duplicates are ignored rather than added twice.
    await user.type(input, "vip{Enter}");
    expect(screen.getAllByRole("button", { name: "Remove vip" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Remove vip" }));
    expect(screen.queryByRole("button", { name: "Remove vip" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Tags selected" })).toHaveTextContent("lead");

    // Backspace on an empty draft removes the last tag.
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.queryByRole("list", { name: "Tags selected" })).not.toBeInTheDocument();
  });
});

describe("ContactDetailScreen", () => {
  it("renders host quick actions", async () => {
    render(
      <ContactDetailScreen
        adapter={adapter()}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        contactId="contact-1"
        quickActions={<button type="button">Call from host</button>}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call from host" })).toBeInTheDocument();
  });

  it("never renders a superseded contact and targets the visible one", async () => {
    const slowAda = deferred<CrmUiResult<ContactDetailVm | null>>();
    const getContact = vi
      .fn<Parameters<ContactsAdapter["getContact"]>, ReturnType<ContactsAdapter["getContact"]>>()
      .mockReturnValueOnce(slowAda.promise)
      .mockResolvedValue(ok(grace));
    const deleteContact = vi.fn(async () => ok(undefined));
    const source = adapter({ getContact, deleteContact });
    const user = userEvent.setup();
    const view = render(
      <ContactDetailScreen
        adapter={source}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        contactId="contact-1"
      />,
    );
    expect(screen.queryByRole("heading", { name: "Ada Lovelace" })).not.toBeInTheDocument();

    view.rerender(
      <ContactDetailScreen
        adapter={source}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        contactId="contact-2"
      />,
    );
    expect(await screen.findByRole("heading", { name: "Grace Hopper" })).toBeInTheDocument();

    await act(async () => {
      slowAda.resolve(ok(ada));
    });
    // The stale load cannot swap the rendered contact under the destructive actions.
    expect(screen.queryByRole("heading", { name: "Ada Lovelace" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Grace Hopper" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete contact" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(deleteContact).toHaveBeenCalledTimes(1));
    expect(deleteContact).toHaveBeenCalledWith("contact-2");
  });

  it("clears the contact when a later load fails so nothing destructive is targetable", async () => {
    const getContact = vi
      .fn<Parameters<ContactsAdapter["getContact"]>, ReturnType<ContactsAdapter["getContact"]>>()
      .mockResolvedValueOnce(ok(ada))
      .mockResolvedValue(failure("Denied", false));
    const source = adapter({ getContact });
    const view = render(
      <ContactDetailScreen
        adapter={source}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        contactId="contact-1"
      />,
    );
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();

    view.rerender(
      <ContactDetailScreen
        adapter={source}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        contactId="contact-2"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Denied");
    expect(screen.queryByRole("heading", { name: "Ada Lovelace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete contact" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save note" })).not.toBeInTheDocument();
  });

  it("confirms deletion in a modal that supports Escape and focus restoration", async () => {
    const deleteContact = vi.fn(async () => ok(undefined));
    const routes = navigation();
    const user = userEvent.setup();
    render(
      <ContactDetailScreen
        adapter={adapter({ deleteContact })}
        capabilities={ALL_CAPABILITIES}
        navigation={routes}
        contactId="contact-1"
      />,
    );
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    await user.click(screen.getByRole("button", { name: "Delete contact" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Delete this contact?");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(deleteContact).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete contact" })).toHaveFocus();
    expect(deleteContact).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete contact" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(deleteContact).toHaveBeenCalledWith("contact-1"));
    await waitFor(() => expect(routes.contacts).toHaveBeenCalledTimes(1));
  });

  it("hides note writes without the update capability", async () => {
    render(
      <ContactDetailScreen
        adapter={adapter({ listNotes: vi.fn(async () => ok([note])) })}
        capabilities={{ ...ALL_CAPABILITIES, update: false }}
        navigation={navigation()}
        contactId="contact-1"
      />,
    );
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText("Existing note")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add note")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit contact" })).not.toBeInTheDocument();
  });

  it("retries the failed note write instead of reloading the contact", async () => {
    const createNote = vi
      .fn<Parameters<ContactsAdapter["createNote"]>, ReturnType<ContactsAdapter["createNote"]>>()
      .mockResolvedValueOnce(failure("Try again", true))
      .mockResolvedValue(
        ok<NoteVm>({
          id: "note-2",
          content: "Follow up",
          createdAt: "2026-09-19T00:00:00Z",
          createdByLabel: null,
        }),
      );
    const getContact = vi.fn(async () => ok(ada));
    const listNotes = vi.fn(async () => ok([]));
    const source = adapter({ createNote, getContact, listNotes });
    const user = userEvent.setup();
    render(
      <ContactDetailScreen
        adapter={source}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        contactId="contact-1"
      />,
    );
    await screen.findByRole("heading", { name: "Ada Lovelace" });

    await user.type(screen.getByLabelText("Add note"), "Follow up");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    await user.click(screen.getByRole("button", { name: "Retry saving note" }));

    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(2));
    expect(createNote).toHaveBeenNthCalledWith(2, "contact-1", "Follow up");
    // The retry replays the mutation; it does not masquerade as a reload.
    expect(getContact).toHaveBeenCalledTimes(1);
    expect(listNotes).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Follow up")).toBeInTheDocument();
    expect(screen.getByLabelText("Add note")).toHaveValue("");
  });

  it("retries a failed contact load", async () => {
    const getContact = vi
      .fn<Parameters<ContactsAdapter["getContact"]>, ReturnType<ContactsAdapter["getContact"]>>()
      .mockResolvedValueOnce(failure("Try again", true))
      .mockResolvedValue(ok(ada));
    const user = userEvent.setup();
    render(
      <ContactDetailScreen
        adapter={adapter({ getContact })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        contactId="contact-1"
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Retry loading contact" }));
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(getContact).toHaveBeenCalledTimes(2);
  });

  it("reports a contact that no longer exists", async () => {
    render(
      <ContactDetailScreen
        adapter={adapter({ getContact: vi.fn(async () => ok(null)) })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
        contactId="contact-1"
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Contact not found.");
    expect(screen.queryByRole("button", { name: "Delete contact" })).not.toBeInTheDocument();
  });
});

describe("ContactImportScreen", () => {
  const csvFile = () =>
    new File(["First,Email\nAda,ada@example.com"], "contacts.csv", { type: "text/csv" });

  async function parseAndMap(user: ReturnType<typeof userEvent.setup>) {
    await user.upload(screen.getByLabelText<HTMLInputElement>("Contact file"), csvFile());
    expect(await screen.findByRole("heading", { name: "Map columns" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Map First"), "first_name");
    await user.selectOptions(screen.getByLabelText("Map Email"), "email");
  }

  it("parses, maps, previews, and commits an import", async () => {
    const source = adapter();
    const user = userEvent.setup();
    render(
      <ContactImportScreen
        adapter={source}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    await parseAndMap(user);

    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText("1 valid, 0 invalid")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import contacts" }));

    await waitFor(() =>
      expect(source.importContacts).toHaveBeenCalledWith({
        rows: parsedA.rows,
        mapping: { First: "first_name", Email: "email" },
      }),
    );
    expect(await screen.findByText("Imported 1; skipped 0.")).toBeInTheDocument();
  });

  it("refuses to import without the import capability", async () => {
    const source = adapter();
    render(
      <ContactImportScreen
        adapter={source}
        capabilities={{ ...ALL_CAPABILITIES, import: false }}
        navigation={navigation()}
      />,
    );
    expect(
      await screen.findByText("You do not have permission to import contacts."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Contact file")).not.toBeInTheDocument();
    expect(source.parseImportFile).not.toHaveBeenCalled();
  });

  it("invalidates the preview when the mapping changes", async () => {
    const user = userEvent.setup();
    render(
      <ContactImportScreen
        adapter={adapter()}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    await parseAndMap(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText("1 valid, 0 invalid")).toBeInTheDocument();

    // A preview describes one exact mapping; changing it drops the preview and
    // therefore the commit control.
    await user.selectOptions(screen.getByLabelText("Map Email"), "ignore");
    await waitFor(() => expect(screen.queryByText("1 valid, 0 invalid")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Import contacts" })).not.toBeInTheDocument();
  });

  it("discards a preview whose mapping changed while it was in flight", async () => {
    const slowPreview = deferred<CrmUiResult<{ valid: number; invalid: number; errors: string[] }>>();
    const previewImport = vi
      .fn<Parameters<ContactsAdapter["previewImport"]>, ReturnType<ContactsAdapter["previewImport"]>>()
      .mockReturnValueOnce(slowPreview.promise)
      .mockResolvedValue(ok({ valid: 1, invalid: 0, errors: [] }));
    const user = userEvent.setup();
    render(
      <ContactImportScreen
        adapter={adapter({ previewImport })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    await parseAndMap(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(previewImport).toHaveBeenCalledTimes(1);

    // Mapping changes while the preview is in flight.
    await user.selectOptions(screen.getByLabelText("Map Email"), "ignore");
    await act(async () => {
      slowPreview.resolve(ok({ valid: 1, invalid: 0, errors: [] }));
    });
    expect(screen.queryByText("1 valid, 0 invalid")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import contacts" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(2));
    expect(previewImport).toHaveBeenNthCalledWith(2, parsedA.rows, {
      First: "first_name",
      Email: "ignore",
    });
    expect(await screen.findByText("1 valid, 0 invalid")).toBeInTheDocument();
  });

  it("invalidates the preview and result when a new file is parsed", async () => {
    const source = adapter({
      parseImportFile: vi
        .fn<
          Parameters<ContactsAdapter["parseImportFile"]>,
          ReturnType<ContactsAdapter["parseImportFile"]>
        >()
        .mockResolvedValueOnce(ok(parsedA))
        .mockResolvedValue(ok(parsedB)),
    });
    const user = userEvent.setup();
    render(
      <ContactImportScreen
        adapter={source}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    await parseAndMap(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText("1 valid, 0 invalid")).toBeInTheDocument();

    await user.upload(screen.getByLabelText<HTMLInputElement>("Contact file"), csvFile());
    await waitFor(() => expect(screen.queryByText("1 valid, 0 invalid")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Import contacts" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Map Name")).toBeInTheDocument();
  });

  it("commits once, blocks a repeat after success, and only retries after failure", async () => {
    const commit = deferred<CrmUiResult<ContactsImportResult>>();
    const importContacts = vi
      .fn<Parameters<ContactsAdapter["importContacts"]>, ReturnType<ContactsAdapter["importContacts"]>>()
      .mockReturnValueOnce(commit.promise)
      .mockResolvedValue(ok<ContactsImportResult>({ imported: 1, skipped: 0 }));
    const user = userEvent.setup();
    render(
      <ContactImportScreen
        adapter={adapter({ importContacts })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    await parseAndMap(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("1 valid, 0 invalid");

    const commitButton = screen.getByRole("button", { name: "Import contacts" });
    await user.click(commitButton);
    // Disabled the moment the commit starts, so a second click cannot double-import.
    expect(commitButton).toBeDisabled();
    await user.click(commitButton);
    expect(importContacts).toHaveBeenCalledTimes(1);

    await act(async () => {
      commit.resolve(ok<ContactsImportResult>({ imported: 1, skipped: 0 }));
    });
    expect(await screen.findByText("Imported 1; skipped 0.")).toBeInTheDocument();
    expect(commitButton).toBeDisabled();
    await user.click(commitButton);
    expect(importContacts).toHaveBeenCalledTimes(1);
  });

  it("retries a failed commit with the previewed snapshot", async () => {
    const importContacts = vi
      .fn<Parameters<ContactsAdapter["importContacts"]>, ReturnType<ContactsAdapter["importContacts"]>>()
      .mockResolvedValueOnce(failure("Try again", true))
      .mockResolvedValue(ok<ContactsImportResult>({ imported: 1, skipped: 0 }));
    const user = userEvent.setup();
    render(
      <ContactImportScreen
        adapter={adapter({ importContacts })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    await parseAndMap(user);
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("1 valid, 0 invalid");

    await user.click(screen.getByRole("button", { name: "Import contacts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");

    // Retry is offered after a failure and replays the same immutable snapshot.
    await user.click(screen.getByRole("button", { name: "Retry importing contacts" }));
    await waitFor(() => expect(importContacts).toHaveBeenCalledTimes(2));
    expect(importContacts).toHaveBeenNthCalledWith(2, {
      rows: parsedA.rows,
      mapping: { First: "first_name", Email: "email" },
    });
    expect(await screen.findByText("Imported 1; skipped 0.")).toBeInTheDocument();
  });

  it("retries a failed parse with the same file", async () => {
    const parseImportFile = vi
      .fn<Parameters<ContactsAdapter["parseImportFile"]>, ReturnType<ContactsAdapter["parseImportFile"]>>()
      .mockResolvedValueOnce(failure("Try again", true))
      .mockResolvedValue(ok(parsedA));
    const user = userEvent.setup();
    render(
      <ContactImportScreen
        adapter={adapter({ parseImportFile })}
        capabilities={ALL_CAPABILITIES}
        navigation={navigation()}
      />,
    );
    const file = csvFile();
    await user.upload(screen.getByLabelText<HTMLInputElement>("Contact file"), file);

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    expect(screen.queryByRole("heading", { name: "Map columns" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry parsing file" }));
    await waitFor(() => expect(parseImportFile).toHaveBeenCalledTimes(2));
    expect(parseImportFile).toHaveBeenNthCalledWith(2, file);
    expect(await screen.findByRole("heading", { name: "Map columns" })).toBeInTheDocument();
  });
});

/**
 * Operation state must never outlive the context it was started in: a pending
 * callback, an error, or a retry from contact A / snapshot A must not mutate,
 * render for, or navigate from B.
 */
describe("operation scope", () => {
  function contactById(id: string): ContactDetailVm {
    return id === "contact-2" ? grace : ada;
  }

  function detailAdapter(overrides: Partial<ContactsAdapter> = {}): ContactsAdapter {
    return adapter({
      getContact: vi.fn(async (id: string) => ok(contactById(id))),
      ...overrides,
    });
  }

  describe("ContactDetailScreen", () => {
    it("closes the confirmation and retargets when the contact changes", async () => {
      const deleteContact = vi.fn(async () => ok(undefined));
      const source = detailAdapter({ deleteContact });
      const user = userEvent.setup();
      const view = render(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      await user.click(screen.getByRole("button", { name: "Delete contact" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      view.rerender(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-2"
        />,
      );
      // The confirmation belonged to contact-1 and cannot survive the change.
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(deleteContact).not.toHaveBeenCalled();

      await screen.findByRole("heading", { name: "Grace Hopper" });
      // …and it must stay closed once contact-2 has loaded.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Delete contact" }));
      await user.click(screen.getByRole("button", { name: "Confirm delete" }));
      await waitFor(() => expect(deleteContact).toHaveBeenCalledTimes(1));
      expect(deleteContact).toHaveBeenCalledWith("contact-2");
    });

    it("invalidates a pending delete when the contact changes", async () => {
      const pendingDelete = deferred<CrmUiResult<void>>();
      const deleteContact = vi
        .fn<Parameters<ContactsAdapter["deleteContact"]>, ReturnType<ContactsAdapter["deleteContact"]>>()
        .mockReturnValue(pendingDelete.promise);
      const routes = navigation();
      const source = detailAdapter({ deleteContact });
      const user = userEvent.setup();
      const view = render(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={routes}
          contactId="contact-1"
        />,
      );
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      await user.click(screen.getByRole("button", { name: "Delete contact" }));
      await user.click(screen.getByRole("button", { name: "Confirm delete" }));
      await waitFor(() => expect(deleteContact).toHaveBeenCalledTimes(1));

      view.rerender(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={routes}
          contactId="contact-2"
        />,
      );
      await screen.findByRole("heading", { name: "Grace Hopper" });

      await act(async () => {
        pendingDelete.resolve(ok(undefined));
      });
      // contact-1's success must not navigate away from contact-2.
      expect(routes.contacts).not.toHaveBeenCalled();
      expect(deleteContact).toHaveBeenCalledTimes(1);
      expect(deleteContact).toHaveBeenCalledWith("contact-1");
      expect(screen.getByRole("heading", { name: "Grace Hopper" })).toBeInTheDocument();
    });

    it("drops a pending note result when the contact changes", async () => {
      const pendingNote = deferred<CrmUiResult<NoteVm>>();
      const createNote = vi
        .fn<Parameters<ContactsAdapter["createNote"]>, ReturnType<ContactsAdapter["createNote"]>>()
        .mockReturnValue(pendingNote.promise);
      const source = detailAdapter({ createNote });
      const user = userEvent.setup();
      const view = render(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      await user.type(screen.getByLabelText("Add note"), "Follow up");
      await user.click(screen.getByRole("button", { name: "Save note" }));
      await waitFor(() => expect(createNote).toHaveBeenCalledWith("contact-1", "Follow up"));

      view.rerender(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-2"
        />,
      );
      await screen.findByRole("heading", { name: "Grace Hopper" });
      expect(screen.getByLabelText("Add note")).toHaveValue("");

      await act(async () => {
        pendingNote.resolve(
          ok<NoteVm>({
            id: "note-9",
            content: "Follow up",
            createdAt: "2026-09-19T00:00:00Z",
            createdByLabel: null,
          }),
        );
      });
      // contact-1's note must not be appended to contact-2's timeline.
      expect(screen.queryByText("Follow up")).not.toBeInTheDocument();
      expect(createNote).toHaveBeenCalledTimes(1);
    });

    it("fails closed when the update capability is revoked after a note failure", async () => {
      const createNote = vi
        .fn<Parameters<ContactsAdapter["createNote"]>, ReturnType<ContactsAdapter["createNote"]>>()
        .mockResolvedValue(failure("Try again", true));
      const source = detailAdapter({ createNote });
      const user = userEvent.setup();
      const view = render(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      await user.type(screen.getByLabelText("Add note"), "Follow up");
      await user.click(screen.getByRole("button", { name: "Save note" }));
      expect(await screen.findByRole("button", { name: "Retry saving note" })).toBeInTheDocument();

      view.rerender(
        <ContactDetailScreen
          adapter={source}
          capabilities={{ ...ALL_CAPABILITIES, update: false }}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      expect(screen.queryByRole("button", { name: "Retry saving note" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Add note")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // Re-granting the capability must not resurrect the revoked retry.
      view.rerender(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      expect(screen.queryByRole("button", { name: "Retry saving note" })).not.toBeInTheDocument();
      expect(createNote).toHaveBeenCalledTimes(1);
    });

    it("closes the confirmation when the remove capability is revoked", async () => {
      const deleteContact = vi.fn(async () => ok(undefined));
      const source = detailAdapter({ deleteContact });
      const user = userEvent.setup();
      const view = render(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      await user.click(screen.getByRole("button", { name: "Delete contact" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      view.rerender(
        <ContactDetailScreen
          adapter={source}
          capabilities={{ ...ALL_CAPABILITIES, remove: false }}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete contact" })).not.toBeInTheDocument();
      expect(deleteContact).not.toHaveBeenCalled();
    });

    it("ignores a load that settles after unmount", async () => {
      const pendingLoad = deferred<CrmUiResult<ContactDetailVm | null>>();
      const getContact = vi
        .fn<Parameters<ContactsAdapter["getContact"]>, ReturnType<ContactsAdapter["getContact"]>>()
        .mockReturnValue(pendingLoad.promise);
      const routes = navigation();
      const view = render(
        <ContactDetailScreen
          adapter={adapter({ getContact })}
          capabilities={ALL_CAPABILITIES}
          navigation={routes}
          contactId="contact-1"
        />,
      );
      expect(screen.getByRole("status")).toHaveTextContent("Loading contact…");

      view.unmount();
      await act(async () => {
        pendingLoad.resolve(ok(ada));
      });
      expect(routes.contact).not.toHaveBeenCalled();
      expect(routes.contacts).not.toHaveBeenCalled();
    });
  });

  describe("ContactFormScreen", () => {
    it("resets input and readiness when switching from edit to create", async () => {
      const source = detailAdapter();
      const view = render(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="edit"
          contactId="contact-1"
        />,
      );
      expect(await screen.findByLabelText("Last name")).toHaveValue("Lovelace");

      view.rerender(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="create"
        />,
      );
      expect(screen.getByRole("heading", { name: "New contact" })).toBeInTheDocument();
      expect(screen.getByLabelText("First name")).toHaveValue("");
      expect(screen.getByLabelText("Last name")).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Save contact" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create contact" })).toBeInTheDocument();
    });

    it("resets readiness when the edit id goes missing", async () => {
      const source = detailAdapter();
      const updateContact = vi.fn(async () => ok(ada));
      const view = render(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="edit"
          contactId="contact-1"
        />,
      );
      expect(await screen.findByLabelText("Last name")).toHaveValue("Lovelace");

      view.rerender(
        <ContactFormScreen
          adapter={adapter({ updateContact })}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="edit"
        />,
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "A contact id is required to edit a contact.",
      );
      expect(screen.queryByLabelText("Last name")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save contact" })).not.toBeInTheDocument();
      expect(updateContact).not.toHaveBeenCalled();
    });

    it("does not navigate when a save settles after unmount", async () => {
      const pendingSave = deferred<CrmUiResult<ContactDetailVm>>();
      const createContact = vi
        .fn<Parameters<ContactsAdapter["createContact"]>, ReturnType<ContactsAdapter["createContact"]>>()
        .mockReturnValue(pendingSave.promise);
      const routes = navigation();
      const user = userEvent.setup();
      const view = render(
        <ContactFormScreen
          adapter={adapter({ createContact })}
          capabilities={ALL_CAPABILITIES}
          navigation={routes}
          mode="create"
        />,
      );
      await user.type(screen.getByLabelText("First name"), "Ada");
      await user.type(screen.getByLabelText("Last name"), "Lovelace");
      await user.click(screen.getByRole("button", { name: "Create contact" }));
      await waitFor(() => expect(createContact).toHaveBeenCalledTimes(1));

      view.unmount();
      await act(async () => {
        pendingSave.resolve(ok(ada));
      });
      expect(routes.contact).not.toHaveBeenCalled();
    });

    it("invalidates a pending save when the edit target changes", async () => {
      const pendingSave = deferred<CrmUiResult<ContactDetailVm>>();
      const updateContact = vi
        .fn<Parameters<ContactsAdapter["updateContact"]>, ReturnType<ContactsAdapter["updateContact"]>>()
        .mockReturnValue(pendingSave.promise);
      const routes = navigation();
      const source = detailAdapter({ updateContact });
      const user = userEvent.setup();
      const view = render(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={routes}
          mode="edit"
          contactId="contact-1"
        />,
      );
      expect(await screen.findByLabelText("Last name")).toHaveValue("Lovelace");
      await user.click(screen.getByRole("button", { name: "Save contact" }));
      await waitFor(() => expect(updateContact).toHaveBeenCalledTimes(1));

      view.rerender(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={routes}
          mode="edit"
          contactId="contact-2"
        />,
      );
      expect(await screen.findByLabelText("Last name")).toHaveValue("Hopper");

      await act(async () => {
        pendingSave.resolve(ok(ada));
      });
      expect(routes.contact).not.toHaveBeenCalled();
      expect(updateContact).toHaveBeenCalledTimes(1);
      expect(updateContact).toHaveBeenCalledWith(
        "contact-1",
        expect.objectContaining({ first_name: "Ada", last_name: "Lovelace" }),
      );
    });

    it("invalidates a pending save when the create capability is revoked", async () => {
      const pendingSave = deferred<CrmUiResult<ContactDetailVm>>();
      const createContact = vi
        .fn<Parameters<ContactsAdapter["createContact"]>, ReturnType<ContactsAdapter["createContact"]>>()
        .mockReturnValue(pendingSave.promise);
      const routes = navigation();
      const source = adapter({ createContact });
      const user = userEvent.setup();
      const view = render(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={routes}
          mode="create"
        />,
      );
      await user.type(screen.getByLabelText("First name"), "Ada");
      await user.type(screen.getByLabelText("Last name"), "Lovelace");
      await user.click(screen.getByRole("button", { name: "Create contact" }));
      await waitFor(() => expect(createContact).toHaveBeenCalledTimes(1));

      view.rerender(
        <ContactFormScreen
          adapter={source}
          capabilities={{ ...ALL_CAPABILITIES, create: false }}
          navigation={routes}
          mode="create"
        />,
      );
      expect(screen.queryByRole("button", { name: "Create contact" })).not.toBeInTheDocument();

      await act(async () => {
        pendingSave.resolve(ok(ada));
      });
      expect(routes.contact).not.toHaveBeenCalled();
    });

    it("drops a stale save retry when the edit target changes", async () => {
      const updateContact = vi
        .fn<Parameters<ContactsAdapter["updateContact"]>, ReturnType<ContactsAdapter["updateContact"]>>()
        .mockResolvedValue(failure("Try again", true));
      const source = detailAdapter({ updateContact });
      const user = userEvent.setup();
      const view = render(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="edit"
          contactId="contact-1"
        />,
      );
      expect(await screen.findByLabelText("Last name")).toHaveValue("Lovelace");
      await user.click(screen.getByRole("button", { name: "Save contact" }));
      expect(await screen.findByRole("button", { name: "Retry saving contact" })).toBeInTheDocument();

      view.rerender(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="edit"
          contactId="contact-2"
        />,
      );
      expect(await screen.findByLabelText("Last name")).toHaveValue("Hopper");
      expect(screen.queryByRole("button", { name: "Retry saving contact" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(updateContact).toHaveBeenCalledTimes(1);
    });
  });

  describe("ContactsScreen bulk actions", () => {
    async function failBulkDelete(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
      await user.click(screen.getByRole("button", { name: "Delete selected" }));
      await user.click(screen.getByRole("button", { name: "Confirm delete" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
      expect(screen.getByRole("button", { name: "Retry deleting selected contacts" })).toBeInTheDocument();
    }

    it("drops the bulk retry when the selection changes", async () => {
      const bulkDeleteContacts = vi
        .fn<
          Parameters<ContactsAdapter["bulkDeleteContacts"]>,
          ReturnType<ContactsAdapter["bulkDeleteContacts"]>
        >()
        .mockResolvedValue(failure("Try again", true));
      const source = adapter({
        listContacts: vi.fn(async () => ok(pageOf([ada], 45))),
        bulkDeleteContacts,
      });
      const user = userEvent.setup();
      render(
        <ContactsScreen adapter={source} capabilities={ALL_CAPABILITIES} navigation={navigation()} />,
      );
      await screen.findByRole("cell", { name: "Ada Lovelace" });
      await failBulkDelete(user);

      // A retry is only valid for the exact selected-id set it failed with.
      await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
      expect(screen.queryByRole("button", { name: "Retry deleting selected contacts" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
      expect(screen.queryByRole("button", { name: "Retry deleting selected contacts" })).not.toBeInTheDocument();
      expect(bulkDeleteContacts).toHaveBeenCalledTimes(1);
    });

    it("drops the bulk retry when the query clears the selection", async () => {
      const bulkDeleteContacts = vi
        .fn<
          Parameters<ContactsAdapter["bulkDeleteContacts"]>,
          ReturnType<ContactsAdapter["bulkDeleteContacts"]>
        >()
        .mockResolvedValue(failure("Try again", true));
      const source = adapter({
        listContacts: vi.fn(async () => ok(pageOf([ada], 45))),
        bulkDeleteContacts,
      });
      const user = userEvent.setup();
      render(
        <ContactsScreen adapter={source} capabilities={ALL_CAPABILITIES} navigation={navigation()} />,
      );
      await screen.findByRole("cell", { name: "Ada Lovelace" });
      await failBulkDelete(user);

      await user.type(screen.getByRole("searchbox"), "Ada");
      await user.click(screen.getByRole("button", { name: "Search" }));

      await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Retry deleting selected contacts" })).not.toBeInTheDocument();
      expect(bulkDeleteContacts).toHaveBeenCalledTimes(1);
    });

    it("drops the bulk retry when the remove capability is revoked", async () => {
      const bulkDeleteContacts = vi
        .fn<
          Parameters<ContactsAdapter["bulkDeleteContacts"]>,
          ReturnType<ContactsAdapter["bulkDeleteContacts"]>
        >()
        .mockResolvedValue(failure("Try again", true));
      const source = adapter({
        listContacts: vi.fn(async () => ok(pageOf([ada], 45))),
        bulkDeleteContacts,
      });
      const user = userEvent.setup();
      const view = render(
        <ContactsScreen adapter={source} capabilities={ALL_CAPABILITIES} navigation={navigation()} />,
      );
      await screen.findByRole("cell", { name: "Ada Lovelace" });
      await failBulkDelete(user);

      view.rerender(
        <ContactsScreen
          adapter={source}
          capabilities={{ ...ALL_CAPABILITIES, remove: false }}
          navigation={navigation()}
        />,
      );
      expect(screen.queryByRole("button", { name: "Delete selected" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry deleting selected contacts" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      view.rerender(
        <ContactsScreen adapter={source} capabilities={ALL_CAPABILITIES} navigation={navigation()} />,
      );
      expect(screen.queryByRole("button", { name: "Retry deleting selected contacts" })).not.toBeInTheDocument();
      expect(bulkDeleteContacts).toHaveBeenCalledTimes(1);
    });
  });

  describe("ContactImportScreen", () => {
    const importFile = () =>
      new File(["First,Email\nAda,ada@example.com"], "contacts.csv", { type: "text/csv" });

    async function parseMapAndPreview(
      user: ReturnType<typeof userEvent.setup>,
      file: File = importFile(),
    ) {
      await user.upload(screen.getByLabelText<HTMLInputElement>("Contact file"), file);
      expect(await screen.findByRole("heading", { name: "Map columns" })).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText("Map First"), "first_name");
      await user.selectOptions(screen.getByLabelText("Map Email"), "email");
      await user.click(screen.getByRole("button", { name: "Preview import" }));
      expect(await screen.findByText("1 valid, 0 invalid")).toBeInTheDocument();
    }

    it("cannot re-import an identical successful snapshot after changing away and back", async () => {
      const importContacts = vi
        .fn<
          Parameters<ContactsAdapter["importContacts"]>,
          ReturnType<ContactsAdapter["importContacts"]>
        >()
        .mockResolvedValue(ok<ContactsImportResult>({ imported: 1, skipped: 0 }));
      const user = userEvent.setup();
      render(
        <ContactImportScreen
          adapter={adapter({ importContacts })}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
        />,
      );
      await parseMapAndPreview(user);
      await user.click(screen.getByRole("button", { name: "Import contacts" }));
      expect(await screen.findByText("Imported 1; skipped 0.")).toBeInTheDocument();

      // Away: the result belongs to the snapshot that produced it.
      await user.selectOptions(screen.getByLabelText("Map Email"), "ignore");
      await waitFor(() =>
        expect(screen.queryByText("Imported 1; skipped 0.")).not.toBeInTheDocument(),
      );

      // Back: the identical successful snapshot can never be imported twice.
      await user.selectOptions(screen.getByLabelText("Map Email"), "email");
      await user.click(screen.getByRole("button", { name: "Preview import" }));
      expect(await screen.findByText("1 valid, 0 invalid")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import contacts" })).toBeDisabled();
      expect(
        await screen.findByText("This file and mapping were already imported."),
      ).toBeInTheDocument();
      expect(importContacts).toHaveBeenCalledTimes(1);
    });

    it("drops a failed commit retry when the mapping changes, then commits the new snapshot", async () => {
      const importContacts = vi
        .fn<
          Parameters<ContactsAdapter["importContacts"]>,
          ReturnType<ContactsAdapter["importContacts"]>
        >()
        .mockResolvedValueOnce(failure("Try again", true))
        .mockResolvedValue(ok<ContactsImportResult>({ imported: 1, skipped: 0 }));
      const user = userEvent.setup();
      render(
        <ContactImportScreen
          adapter={adapter({ importContacts })}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
        />,
      );
      await parseMapAndPreview(user);
      await user.click(screen.getByRole("button", { name: "Import contacts" }));
      expect(await screen.findByRole("button", { name: "Retry importing contacts" })).toBeInTheDocument();

      // The retry belongs to the old snapshot only.
      await user.selectOptions(screen.getByLabelText("Map Email"), "ignore");
      expect(screen.queryByRole("button", { name: "Retry importing contacts" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("1 valid, 0 invalid")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Preview import" }));
      expect(await screen.findByText("1 valid, 0 invalid")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Import contacts" }));

      await waitFor(() => expect(importContacts).toHaveBeenCalledTimes(2));
      expect(importContacts).toHaveBeenNthCalledWith(2, {
        rows: parsedA.rows,
        mapping: { First: "first_name", Email: "ignore" },
      });
      expect(await screen.findByText("Imported 1; skipped 0.")).toBeInTheDocument();
    });

    it("resets imported snapshots only for a genuinely new file", async () => {
      const importContacts = vi
        .fn<
          Parameters<ContactsAdapter["importContacts"]>,
          ReturnType<ContactsAdapter["importContacts"]>
        >()
        .mockResolvedValue(ok<ContactsImportResult>({ imported: 1, skipped: 0 }));
      const source = adapter({
        importContacts,
        parseImportFile: vi
          .fn<
            Parameters<ContactsAdapter["parseImportFile"]>,
            ReturnType<ContactsAdapter["parseImportFile"]>
          >()
          .mockResolvedValueOnce(ok(parsedA))
          .mockResolvedValue(ok(parsedB)),
      });
      const user = userEvent.setup();
      render(
        <ContactImportScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
        />,
      );
      await parseMapAndPreview(user);
      await user.click(screen.getByRole("button", { name: "Import contacts" }));
      expect(await screen.findByText("Imported 1; skipped 0.")).toBeInTheDocument();

      // New rows are a new snapshot: committing it is allowed.
      await user.upload(screen.getByLabelText<HTMLInputElement>("Contact file"), importFile());
      await screen.findByLabelText("Map Name");
      await user.selectOptions(screen.getByLabelText("Map Name"), "first_name");
      await user.click(screen.getByRole("button", { name: "Preview import" }));
      expect(await screen.findByText("1 valid, 0 invalid")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import contacts" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Import contacts" }));
      await waitFor(() => expect(importContacts).toHaveBeenCalledTimes(2));
      expect(importContacts).toHaveBeenNthCalledWith(2, {
        rows: parsedB.rows,
        mapping: { Name: "first_name" },
      });
    });

    it("disables the file and mapping controls while a commit is pending", async () => {
      const pendingCommit = deferred<CrmUiResult<ContactsImportResult>>();
      const importContacts = vi
        .fn<
          Parameters<ContactsAdapter["importContacts"]>,
          ReturnType<ContactsAdapter["importContacts"]>
        >()
        .mockReturnValue(pendingCommit.promise);
      const user = userEvent.setup();
      render(
        <ContactImportScreen
          adapter={adapter({ importContacts })}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
        />,
      );
      await parseMapAndPreview(user);
      await user.click(screen.getByRole("button", { name: "Import contacts" }));

      expect(screen.getByLabelText<HTMLInputElement>("Contact file")).toBeDisabled();
      expect(screen.getByLabelText("Map First")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Preview import" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Import contacts" })).toBeDisabled();

      await act(async () => {
        pendingCommit.resolve(ok<ContactsImportResult>({ imported: 1, skipped: 0 }));
      });
      expect(await screen.findByText("Imported 1; skipped 0.")).toBeInTheDocument();
      expect(screen.getByLabelText("Map First")).toBeEnabled();
      expect(importContacts).toHaveBeenCalledTimes(1);
    });

    it("ignores a commit that settles after unmount", async () => {
      const pendingCommit = deferred<CrmUiResult<ContactsImportResult>>();
      const importContacts = vi
        .fn<
          Parameters<ContactsAdapter["importContacts"]>,
          ReturnType<ContactsAdapter["importContacts"]>
        >()
        .mockReturnValue(pendingCommit.promise);
      const routes = navigation();
      const user = userEvent.setup();
      const view = render(
        <ContactImportScreen
          adapter={adapter({ importContacts })}
          capabilities={ALL_CAPABILITIES}
          navigation={routes}
        />,
      );
      await parseMapAndPreview(user);
      await user.click(screen.getByRole("button", { name: "Import contacts" }));
      await waitFor(() => expect(importContacts).toHaveBeenCalledTimes(1));

      view.unmount();
      await act(async () => {
        pendingCommit.resolve(ok<ContactsImportResult>({ imported: 1, skipped: 0 }));
      });
      expect(routes.contacts).not.toHaveBeenCalled();
    });
  });
});

/**
 * Round 3: commit-safe retirement, adapter throws, canonical snapshots.
 */
describe("operation lifecycle", () => {
  function contactById(id: string): ContactDetailVm {
    return id === "contact-2" ? grace : ada;
  }

  function detailAdapter(overrides: Partial<ContactsAdapter> = {}): ContactsAdapter {
    return adapter({
      getContact: vi.fn(async (id: string) => ok(contactById(id))),
      ...overrides,
    });
  }

  describe("adapter throws", () => {
    it("reports a rejecting save as a stable non-retryable error and clears pending", async () => {
      const createContact = vi.fn(async () => {
        throw new Error("boom");
      });
      const user = userEvent.setup();
      render(
        <ContactFormScreen
          adapter={adapter({ createContact })}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="create"
        />,
      );
      await user.type(screen.getByLabelText("First name"), "Ada");
      await user.type(screen.getByLabelText("Last name"), "Lovelace");
      await user.click(screen.getByRole("button", { name: "Create contact" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The operation failed unexpectedly.",
      );
      expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
      // Not perma-pending: the control is usable again.
      expect(screen.getByRole("button", { name: "Create contact" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Create contact" }));
      await waitFor(() => expect(createContact).toHaveBeenCalledTimes(2));
    });

    it("clears the list loading state when the adapter rejects", async () => {
      const listContacts = vi.fn(async () => {
        throw new Error("boom");
      });
      render(
        <ContactsScreen
          adapter={adapter({ listContacts })}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
        />,
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The operation failed unexpectedly.",
      );
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("clears the detail loading state when the adapter rejects", async () => {
      const getContact = vi.fn(async () => {
        throw new Error("boom");
      });
      render(
        <ContactDetailScreen
          adapter={adapter({ getContact })}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The operation failed unexpectedly.",
      );
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete contact" })).not.toBeInTheDocument();
    });
  });

  describe("import snapshots", () => {
    const importFile = () =>
      new File(["First,Email\nAda,ada@example.com"], "contacts.csv", { type: "text/csv" });

    async function parseMapAndPreview(user: ReturnType<typeof userEvent.setup>) {
      await user.upload(screen.getByLabelText<HTMLInputElement>("Contact file"), importFile());
      expect(await screen.findByRole("heading", { name: "Map columns" })).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText("Map First"), "first_name");
      await user.selectOptions(screen.getByLabelText("Map Email"), "email");
      await user.click(screen.getByRole("button", { name: "Preview import" }));
      expect(await screen.findByText("1 valid, 0 invalid")).toBeInTheDocument();
    }

    it("cannot recommit the same rows and mapping after reselecting the file", async () => {
      const importContacts = vi
        .fn<
          Parameters<ContactsAdapter["importContacts"]>,
          ReturnType<ContactsAdapter["importContacts"]>
        >()
        .mockResolvedValue(ok<ContactsImportResult>({ imported: 1, skipped: 0 }));
      const user = userEvent.setup();
      render(
        <ContactImportScreen
          adapter={adapter({ importContacts })}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
        />,
      );
      await parseMapAndPreview(user);
      await user.click(screen.getByRole("button", { name: "Import contacts" }));
      expect(await screen.findByText("Imported 1; skipped 0.")).toBeInTheDocument();

      // The identical payload parsed again is the identical snapshot: the record
      // survives a reselect because it is derived from the data, not a counter.
      await parseMapAndPreview(user);
      expect(screen.getByRole("button", { name: "Import contacts" })).toBeDisabled();
      expect(
        screen.getByText("This file and mapping were already imported."),
      ).toBeInTheDocument();
      expect(importContacts).toHaveBeenCalledTimes(1);
    });

    it("treats reordered row keys as the same snapshot", async () => {
      const importContacts = vi
        .fn<
          Parameters<ContactsAdapter["importContacts"]>,
          ReturnType<ContactsAdapter["importContacts"]>
        >()
        .mockResolvedValue(ok<ContactsImportResult>({ imported: 1, skipped: 0 }));
      const parseImportFile = vi
        .fn<
          Parameters<ContactsAdapter["parseImportFile"]>,
          ReturnType<ContactsAdapter["parseImportFile"]>
        >()
        .mockResolvedValueOnce(ok(parsedA))
        .mockResolvedValue(
          // Same content, different key insertion order.
          ok({ rows: [{ Email: "ada@example.com", First: "Ada" }], columns: ["First", "Email"] }),
        );
      const user = userEvent.setup();
      render(
        <ContactImportScreen
          adapter={adapter({ importContacts, parseImportFile })}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
        />,
      );
      await parseMapAndPreview(user);
      await user.click(screen.getByRole("button", { name: "Import contacts" }));
      expect(await screen.findByText("Imported 1; skipped 0.")).toBeInTheDocument();

      await parseMapAndPreview(user);
      expect(screen.getByRole("button", { name: "Import contacts" })).toBeDisabled();
      expect(importContacts).toHaveBeenCalledTimes(1);
      expect(importContacts).toHaveBeenNthCalledWith(1, {
        rows: parsedA.rows,
        mapping: { First: "first_name", Email: "email" },
      });
    });

    it("retires import retries when the import capability is revoked", async () => {
      const importContacts = vi
        .fn<
          Parameters<ContactsAdapter["importContacts"]>,
          ReturnType<ContactsAdapter["importContacts"]>
        >()
        .mockResolvedValue(failure("Try again", true));
      const source = adapter({ importContacts });
      const user = userEvent.setup();
      const view = render(
        <ContactImportScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
        />,
      );
      await parseMapAndPreview(user);
      await user.click(screen.getByRole("button", { name: "Import contacts" }));
      expect(
        await screen.findByRole("button", { name: "Retry importing contacts" }),
      ).toBeInTheDocument();

      view.rerender(
        <ContactImportScreen
          adapter={source}
          capabilities={{ ...ALL_CAPABILITIES, import: false }}
          navigation={navigation()}
        />,
      );
      expect(
        screen.getByText("You do not have permission to import contacts."),
      ).toBeInTheDocument();

      view.rerender(
        <ContactImportScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Retry importing contacts" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(importContacts).toHaveBeenCalledTimes(1);
    });
  });

  describe("confirmation retirement", () => {
    it("retires the delete confirmation when the remove capability is revoked", async () => {
      const deleteContact = vi.fn(async () => ok(undefined));
      const source = detailAdapter({ deleteContact });
      const user = userEvent.setup();
      const view = render(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      await user.click(screen.getByRole("button", { name: "Delete contact" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      view.rerender(
        <ContactDetailScreen
          adapter={source}
          capabilities={{ ...ALL_CAPABILITIES, remove: false }}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Retired, not hidden: re-granting must not reopen a pending deletion.
      view.rerender(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(deleteContact).not.toHaveBeenCalled();
    });

    it("retires the delete confirmation when the contact changes and does not resurrect it", async () => {
      const deleteContact = vi.fn(async () => ok(undefined));
      const source = detailAdapter({ deleteContact });
      const user = userEvent.setup();
      const view = render(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      await user.click(screen.getByRole("button", { name: "Delete contact" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      view.rerender(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-2"
        />,
      );
      await screen.findByRole("heading", { name: "Grace Hopper" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      view.rerender(
        <ContactDetailScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          contactId="contact-1"
        />,
      );
      await screen.findByRole("heading", { name: "Ada Lovelace" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(deleteContact).not.toHaveBeenCalled();
    });

    it("retires the bulk confirmation when the selection changes", async () => {
      const bulkDeleteContacts = vi
        .fn<
          Parameters<ContactsAdapter["bulkDeleteContacts"]>,
          ReturnType<ContactsAdapter["bulkDeleteContacts"]>
        >()
        .mockResolvedValue(ok({ deleted: 1 }));
      const source = adapter({
        listContacts: vi.fn(async () => ok(pageOf([ada], 45))),
        bulkDeleteContacts,
      });
      const user = userEvent.setup();
      render(
        <ContactsScreen adapter={source} capabilities={ALL_CAPABILITIES} navigation={navigation()} />,
      );
      await screen.findByRole("cell", { name: "Ada Lovelace" });
      await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
      await user.click(screen.getByRole("button", { name: "Delete selected" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // The confirmation cannot follow a changed selection.
      await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(bulkDeleteContacts).not.toHaveBeenCalled();
    });
  });

  describe("form context gating", () => {
    it("cannot submit stale values after switching from edit to create", async () => {
      const createContact = vi.fn(async () => ok(ada));
      const source = detailAdapter({ createContact });
      const user = userEvent.setup();
      const view = render(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="edit"
          contactId="contact-1"
        />,
      );
      expect(await screen.findByLabelText("Last name")).toHaveValue("Lovelace");

      view.rerender(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="create"
        />,
      );
      expect(screen.getByLabelText("First name")).toHaveValue("");
      expect(screen.getByLabelText("Last name")).toHaveValue("");

      // The handler itself refuses the previous context's values.
      await user.click(screen.getByRole("button", { name: "Create contact" }));
      expect(screen.getByRole("alert")).toHaveTextContent("First and last name are required.");
      expect(createContact).not.toHaveBeenCalled();
    });

    it("cannot submit stale values after switching to another contact", async () => {
      const updateContact = vi.fn(async (id: string) => ok(contactById(id)));
      const getContact = vi
        .fn<Parameters<ContactsAdapter["getContact"]>, ReturnType<ContactsAdapter["getContact"]>>()
        .mockResolvedValueOnce(ok(ada))
        .mockReturnValue(deferred<CrmUiResult<ContactDetailVm | null>>().promise);
      const source = adapter({ updateContact, getContact });
      const view = render(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="edit"
          contactId="contact-1"
        />,
      );
      expect(await screen.findByLabelText("Last name")).toHaveValue("Lovelace");

      // contact-2 never finishes loading: the form must stay closed, not fall
      // back to contact-1's values.
      view.rerender(
        <ContactFormScreen
          adapter={source}
          capabilities={ALL_CAPABILITIES}
          navigation={navigation()}
          mode="edit"
          contactId="contact-2"
        />,
      );
      expect(screen.queryByLabelText("Last name")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Loading contact…");
      expect(screen.queryByRole("button", { name: "Save contact" })).not.toBeInTheDocument();
      expect(updateContact).not.toHaveBeenCalled();
    });
  });
});
