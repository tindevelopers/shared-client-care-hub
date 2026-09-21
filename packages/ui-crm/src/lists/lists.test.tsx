// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContactsAdapter } from "../contacts";
import type { CrmCapabilities, CrmNavigation, CrmUiResult } from "../index";
import {
  ListDetailScreen,
  ListsScreen,
  type ContactListDetailVm,
  type ContactListPage,
  type ContactListVm,
  type ListsAdapter,
} from "../lists";

const capabilities: CrmCapabilities = {
  create: true,
  update: true,
  remove: true,
  import: true,
  bulkActions: true,
};

const routes: CrmNavigation = {
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

const list: ContactListVm = {
  id: "list-1",
  tenant_id: "tenant-1",
  name: "Customers",
  description: "Current customers",
  color: null,
  created_by: null,
  created_at: "2026-09-19",
  updated_at: "2026-09-19",
  kind: "list",
  definition: null,
  memberCount: 1,
};

const contact = {
  id: "contact-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  phone: null,
  mobile: null,
  job_title: null,
  tags: [],
  sms_opt_out: false,
  email_opt_out: false,
  whatsapp_opt_out: false,
  updated_at: "2026-09-19",
  companyName: null,
};

function ok<T>(data: T): CrmUiResult<T> {
  return { ok: true, data };
}

function page(items: ContactListVm[]): ContactListPage {
  return { items, total: items.length, limit: 20, offset: 0 };
}

function listAdapter(overrides: Partial<ListsAdapter> = {}): ListsAdapter {
  return {
    listLists: vi.fn(async () => ok(page([list]))),
    getList: vi.fn(async () =>
      ok<ContactListDetailVm>({ ...list, members: { items: [contact], total: 1, limit: 20, offset: 0 } }),
    ),
    createList: vi.fn(async (input) => ok({ ...list, ...input })),
    updateList: vi.fn(async () => ok(undefined)),
    deleteList: vi.fn(async () => ok(undefined)),
    searchContacts: vi.fn(async () =>
      ok({ items: [contact], total: 21, limit: 20, offset: 0 }),
    ),
    addMembers: vi.fn(async (_id, ids) => ok({ added: ids.length })),
    removeMembers: vi.fn(async (_id, ids) => ok({ removed: ids.length })),
    ...overrides,
  };
}

const contacts = {} as ContactsAdapter;

describe("ListsScreen", () => {
  it("creates, edits, and confirms deletion", async () => {
    const source = listAdapter();
    const user = userEvent.setup();
    render(
      <ListsScreen
        adapter={source}
        contacts={contacts}
        capabilities={capabilities}
        navigation={routes}
      />,
    );
    await screen.findByRole("button", { name: "Customers" });

    await user.type(screen.getByLabelText("List name"), "Prospects");
    await user.click(screen.getByRole("button", { name: "Create list" }));
    await waitFor(() =>
      expect(source.createList).toHaveBeenCalledWith(expect.objectContaining({ name: "Prospects" })),
    );

    await user.click(screen.getByRole("button", { name: "Edit Customers" }));
    await user.clear(screen.getByLabelText("Edit list name"));
    await user.type(screen.getByLabelText("Edit list name"), "Clients");
    await user.click(screen.getByRole("button", { name: "Save list" }));
    await waitFor(() =>
      expect(source.updateList).toHaveBeenCalledWith(
        "list-1",
        expect.objectContaining({ name: "Clients" }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Delete Customers" }));
    expect(source.deleteList).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(source.deleteList).toHaveBeenCalledWith("list-1"));
  });

  it("shows typed duplicate-name errors and hides denied mutations", async () => {
    const source = listAdapter({
      createList: vi.fn(async () => ({
        ok: false,
        error: { code: "duplicate_name", message: "A list with this name exists.", retryable: false },
      })),
    });
    const user = userEvent.setup();
    const view = render(
      <ListsScreen
        adapter={source}
        contacts={contacts}
        capabilities={capabilities}
        navigation={routes}
      />,
    );
    await screen.findByRole("button", { name: "Customers" });
    await user.type(screen.getByLabelText("List name"), "Customers");
    await user.click(screen.getByRole("button", { name: "Create list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A list with this name exists.");

    view.rerender(
      <ListsScreen
        adapter={source}
        contacts={contacts}
        capabilities={{ ...capabilities, create: false, update: false, remove: false }}
        navigation={routes}
      />,
    );
    expect(screen.queryByRole("button", { name: "Create list" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Customers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Customers" })).not.toBeInTheDocument();
  });
});

describe("ListDetailScreen", () => {
  it("pages search and treats empty selections as no-ops", async () => {
    const source = listAdapter();
    const user = userEvent.setup();
    render(
      <ListDetailScreen
        adapter={source}
        contacts={contacts}
        capabilities={capabilities}
        navigation={routes}
        listId="list-1"
      />,
    );
    await screen.findByRole("heading", { name: "Customers" });
    expect(screen.getByRole("button", { name: "Add selected members" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove selected members" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next contacts" }));
    await waitFor(() =>
      expect(source.searchContacts).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 20, offset: 20 }),
      ),
    );
    expect(source.addMembers).not.toHaveBeenCalled();
    expect(source.removeMembers).not.toHaveBeenCalled();
  });

  it("adds and removes exact selected members", async () => {
    const source = listAdapter();
    const user = userEvent.setup();
    render(
      <ListDetailScreen
        adapter={source}
        contacts={contacts}
        capabilities={capabilities}
        navigation={routes}
        listId="list-1"
      />,
    );
    await screen.findByRole("heading", { name: "Customers" });
    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace to add" }));
    await user.click(screen.getByRole("button", { name: "Add selected members" }));
    await waitFor(() => expect(source.addMembers).toHaveBeenCalledWith("list-1", ["contact-1"]));

    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace for removal" }));
    await user.click(screen.getByRole("button", { name: "Remove selected members" }));
    expect(source.removeMembers).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() =>
      expect(source.removeMembers).toHaveBeenCalledWith("list-1", ["contact-1"]),
    );
  });
});
