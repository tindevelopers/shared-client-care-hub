// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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

const listTwo: ContactListVm = { ...list, id: "list-2", name: "Prospects" };
const contactTwo = { ...contact, id: "contact-2", first_name: "Grace", last_name: "Hopper" };

function ok<T>(data: T): CrmUiResult<T> {
  return { ok: true, data };
}

function failure<T = never>(message = "Try again", code = "temporary"): CrmUiResult<T> {
  return { ok: false, error: { code, message, retryable: true } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
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
    expect(screen.getByLabelText("List name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("List name")).toHaveAttribute(
      "aria-describedby",
      "create-list-error",
    );

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

  it("associates edit duplicate errors and retires them when the payload changes", async () => {
    const updateList = vi.fn(async () =>
      failure<void>("A list with this name exists.", "duplicate_name"),
    );
    const source = listAdapter({ updateList });
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
    await user.click(screen.getByRole("button", { name: "Edit Customers" }));
    await user.click(screen.getByRole("button", { name: "Save list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A list with this name exists.");
    expect(screen.getByLabelText("Edit list name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Edit list name")).toHaveAttribute(
      "aria-describedby",
      "edit-list-error",
    );

    await user.type(screen.getByLabelText("Edit description"), " changed");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Edit list name")).not.toHaveAttribute("aria-invalid");
  });

  it("keeps a failed delete target for an exact retry", async () => {
    const deleteList = vi
      .fn<Parameters<ListsAdapter["deleteList"]>, ReturnType<ListsAdapter["deleteList"]>>()
      .mockResolvedValueOnce(failure<void>())
      .mockResolvedValue(ok(undefined));
    const source = listAdapter({ deleteList });
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
    await user.click(screen.getByRole("button", { name: "Delete Customers" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry deleting list" }));
    await waitFor(() => expect(deleteList).toHaveBeenCalledTimes(2));
    expect(deleteList).toHaveBeenNthCalledWith(1, "list-1");
    expect(deleteList).toHaveBeenNthCalledWith(2, "list-1");
  });

  it("renders only the latest list request and safely handles adapter rejection", async () => {
    const slow = deferred<CrmUiResult<ContactListPage>>();
    const listLists = vi
      .fn<Parameters<ListsAdapter["listLists"]>, ReturnType<ListsAdapter["listLists"]>>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(ok(page([listTwo])));
    const user = userEvent.setup();
    const view = render(
      <ListsScreen
        adapter={listAdapter({ listLists })}
        contacts={contacts}
        capabilities={capabilities}
        navigation={routes}
      />,
    );
    await user.type(screen.getByLabelText("Search lists"), "Prospects");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("button", { name: "Prospects" })).toBeInTheDocument();
    await act(async () => slow.resolve(ok(page([list]))));
    expect(screen.queryByRole("button", { name: "Customers" })).not.toBeInTheDocument();

    view.unmount();
    render(
      <ListsScreen
        adapter={listAdapter({
          listLists: vi.fn(async () => Promise.reject(new Error("provider secret"))),
        })}
        contacts={contacts}
        capabilities={capabilities}
        navigation={routes}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The operation failed unexpectedly.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("provider secret");
  });

  it("retires mutation retry when capability is revoked", async () => {
    const createList = vi.fn(async () => failure<ContactListVm>());
    const source = listAdapter({ createList });
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
    await user.type(screen.getByLabelText("List name"), "New");
    await user.click(screen.getByRole("button", { name: "Create list" }));
    expect(await screen.findByRole("button", { name: "Retry creating list" })).toBeInTheDocument();

    view.rerender(
      <ListsScreen
        adapter={source}
        contacts={contacts}
        capabilities={{ ...capabilities, create: false }}
        navigation={routes}
      />,
    );
    view.rerender(
      <ListsScreen
        adapter={source}
        contacts={contacts}
        capabilities={capabilities}
        navigation={routes}
      />,
    );
    expect(screen.queryByRole("button", { name: "Retry creating list" })).not.toBeInTheDocument();
    expect(createList).toHaveBeenCalledTimes(1);
  });

  it("locks create and edit payload controls while each write is pending", async () => {
    const createResult = deferred<CrmUiResult<ContactListVm>>();
    const editResult = deferred<CrmUiResult<void>>();
    const createList = vi
      .fn<Parameters<ListsAdapter["createList"]>, ReturnType<ListsAdapter["createList"]>>()
      .mockReturnValue(createResult.promise);
    const updateList = vi
      .fn<Parameters<ListsAdapter["updateList"]>, ReturnType<ListsAdapter["updateList"]>>()
      .mockReturnValue(editResult.promise);
    const source = listAdapter({ createList, updateList });
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
    await user.type(screen.getByLabelText("List name"), "Pending");
    await user.click(screen.getByRole("button", { name: "Create list" }));
    expect(screen.getByLabelText("List name")).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeDisabled();
    await user.type(screen.getByLabelText("List name"), " second");
    await user.click(screen.getByRole("button", { name: "Create list" }));
    expect(createList).toHaveBeenCalledTimes(1);

    await act(async () => createResult.resolve(failure<ContactListVm>()));
    expect(await screen.findByRole("button", { name: "Retry creating list" })).toBeInTheDocument();
    expect(screen.getByLabelText("List name")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Edit Customers" }));
    await user.click(screen.getByRole("button", { name: "Save list" }));
    expect(screen.getByLabelText("Edit list name")).toBeDisabled();
    expect(screen.getByLabelText("Edit description")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel editing" })).toBeDisabled();
    await user.type(screen.getByLabelText("Edit description"), " second");
    await user.click(screen.getByRole("button", { name: "Save list" }));
    expect(updateList).toHaveBeenCalledTimes(1);

    await act(async () => editResult.resolve(failure<void>()));
    expect(await screen.findByRole("button", { name: "Retry updating list" })).toBeInTheDocument();
    expect(screen.getByLabelText("Edit list name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel editing" })).toBeEnabled();
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

  it("drops stale detail/search identities and resets search selection", async () => {
    const slowDetail = deferred<CrmUiResult<ContactListDetailVm | null>>();
    const slowSearch = deferred<CrmUiResult<{ items: typeof contact[]; total: number; limit: number; offset: number }>>();
    const getList = vi
      .fn<Parameters<ListsAdapter["getList"]>, ReturnType<ListsAdapter["getList"]>>()
      .mockReturnValueOnce(slowDetail.promise)
      .mockResolvedValue(
        ok({ ...listTwo, members: { items: [contactTwo], total: 1, limit: 20, offset: 0 } }),
      );
    const searchContacts = vi
      .fn<Parameters<ListsAdapter["searchContacts"]>, ReturnType<ListsAdapter["searchContacts"]>>()
      .mockReturnValueOnce(slowSearch.promise)
      .mockResolvedValue(ok({ items: [contactTwo], total: 1, limit: 20, offset: 0 }));
    const source = listAdapter({ getList, searchContacts });
    const user = userEvent.setup();
    const view = render(
      <ListDetailScreen
        adapter={source}
        contacts={contacts}
        capabilities={capabilities}
        navigation={routes}
        listId="list-1"
      />,
    );
    view.rerender(
      <ListDetailScreen
        adapter={source}
        contacts={contacts}
        capabilities={capabilities}
        navigation={routes}
        listId="list-2"
      />,
    );
    expect(await screen.findByRole("heading", { name: "Prospects" })).toBeInTheDocument();
    expect(
      await screen.findByRole("checkbox", { name: "Select Grace Hopper to add" }),
    ).toBeInTheDocument();
    await act(async () => {
      slowDetail.resolve(
        ok({ ...list, members: { items: [contact], total: 1, limit: 20, offset: 0 } }),
      );
      slowSearch.resolve(ok({ items: [contact], total: 1, limit: 20, offset: 0 }));
    });
    expect(screen.queryByRole("heading", { name: "Customers" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select Grace Hopper to add" }));
    await user.type(screen.getByLabelText("Search contacts"), "new");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Select Grace Hopper to add" })).not.toBeChecked(),
    );
  });

  it("retries the exact member mutation and retires scoped confirmation", async () => {
    const addMembers = vi
      .fn<Parameters<ListsAdapter["addMembers"]>, ReturnType<ListsAdapter["addMembers"]>>()
      .mockResolvedValueOnce(failure<{ added: number }>())
      .mockResolvedValue(ok({ added: 1 }));
    const source = listAdapter({ addMembers });
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
    await user.click(await screen.findByRole("button", { name: "Retry adding members" }));
    await waitFor(() => expect(addMembers).toHaveBeenCalledTimes(2));
    expect(addMembers).toHaveBeenNthCalledWith(2, "list-1", ["contact-1"]);

    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace for removal" }));
    await user.click(screen.getByRole("button", { name: "Remove selected members" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace for removal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(source.removeMembers).not.toHaveBeenCalled();
  });

  it("locks member selections and query controls while mutations are pending", async () => {
    const addResult = deferred<CrmUiResult<{ added: number }>>();
    const removeResult = deferred<CrmUiResult<{ removed: number }>>();
    const addMembers = vi
      .fn<Parameters<ListsAdapter["addMembers"]>, ReturnType<ListsAdapter["addMembers"]>>()
      .mockReturnValue(addResult.promise);
    const removeMembers = vi
      .fn<Parameters<ListsAdapter["removeMembers"]>, ReturnType<ListsAdapter["removeMembers"]>>()
      .mockReturnValue(removeResult.promise);
    const source = listAdapter({ addMembers, removeMembers });
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
    const addSelection = screen.getByRole("checkbox", { name: "Select Ada Lovelace to add" });
    await user.click(addSelection);
    await user.click(screen.getByRole("button", { name: "Add selected members" }));
    expect(addSelection).toBeDisabled();
    expect(screen.getByLabelText("Search contacts")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next contacts" })).toBeDisabled();
    await user.click(addSelection);
    await user.click(screen.getByRole("button", { name: "Add selected members" }));
    expect(addMembers).toHaveBeenCalledTimes(1);

    await act(async () => addResult.resolve(failure<{ added: number }>()));
    expect(await screen.findByRole("button", { name: "Retry adding members" })).toBeInTheDocument();
    expect(addSelection).toBeEnabled();
    expect(screen.getByLabelText("Search contacts")).toBeEnabled();

    const removeSelection = screen.getByRole("checkbox", {
      name: "Select Ada Lovelace for removal",
    });
    await user.click(removeSelection);
    await user.click(screen.getByRole("button", { name: "Remove selected members" }));
    await user.click(screen.getByRole("button", { name: "Confirm removal" }));
    expect(removeSelection).toBeDisabled();
    await user.click(removeSelection);
    expect(removeMembers).toHaveBeenCalledTimes(1);

    await act(async () => removeResult.resolve(failure<{ removed: number }>()));
    expect(
      await screen.findByRole("button", { name: "Retry removing members" }),
    ).toBeInTheDocument();
    expect(removeSelection).toBeEnabled();
  });
});
