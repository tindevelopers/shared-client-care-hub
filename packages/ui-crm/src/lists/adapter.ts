import type { ContactsAdapter } from "../contacts/adapter.js";
import type { ContactPage, ContactQuery } from "../contacts/types.js";
import type { CrmCapabilities } from "../core/capabilities.js";
import type { CrmNavigation } from "../core/navigation.js";
import type { CrmUiResult } from "../core/result.js";
import type {
  ContactListDetailVm,
  ContactListInput,
  ContactListPage,
  ContactListPatch,
  ContactListVm,
  ListQuery,
} from "./types.js";

export interface ListsAdapter {
  listLists(query?: ListQuery): Promise<CrmUiResult<ContactListPage>>;
  getList(id: string): Promise<CrmUiResult<ContactListDetailVm | null>>;
  createList(input: ContactListInput): Promise<CrmUiResult<ContactListVm>>;
  updateList(id: string, patch: ContactListPatch): Promise<CrmUiResult<void>>;
  deleteList(id: string): Promise<CrmUiResult<void>>;
  searchContacts(query: ContactQuery): Promise<CrmUiResult<ContactPage>>;
  addMembers(id: string, contactIds: string[]): Promise<CrmUiResult<{ added: number }>>;
  removeMembers(id: string, contactIds: string[]): Promise<CrmUiResult<{ removed: number }>>;
}

export interface ListsScreenProps {
  adapter: ListsAdapter;
  contacts: ContactsAdapter;
  capabilities: CrmCapabilities;
  navigation: CrmNavigation;
  className?: string;
}

export interface ListDetailScreenProps extends ListsScreenProps {
  listId: string;
}
