import type { ReactNode } from "react";
import type { CrmCapabilities } from "../core/capabilities.js";
import type { CrmNavigation } from "../core/navigation.js";
import type { CrmUiResult } from "../core/result.js";
import type {
  ActivityVm,
  ContactDetailVm,
  ContactFieldMapping,
  ContactInput,
  ContactPage,
  ContactPatch,
  ContactQuery,
  ContactsImportInput,
  ContactsImportPreview,
  ContactsImportResult,
  JsonRow,
  NoteVm,
  ParsedImport,
} from "./types.js";

export interface ContactsAdapter {
  listContacts(query?: ContactQuery): Promise<CrmUiResult<ContactPage>>;
  getContact(id: string): Promise<CrmUiResult<ContactDetailVm | null>>;
  createContact(input: ContactInput): Promise<CrmUiResult<ContactDetailVm>>;
  updateContact(id: string, patch: ContactPatch): Promise<CrmUiResult<ContactDetailVm>>;
  deleteContact(id: string): Promise<CrmUiResult<void>>;
  bulkDeleteContacts(ids: string[]): Promise<CrmUiResult<{ deleted: number }>>;
  assignTags(ids: string[], tags: string[]): Promise<CrmUiResult<{ updated: number }>>;
  listTags(): Promise<CrmUiResult<string[]>>;
  listCompanyOptions(): Promise<CrmUiResult<Array<{ id: string; name: string }>>>;
  listActivities(contactId: string): Promise<CrmUiResult<ActivityVm[]>>;
  listNotes(contactId: string): Promise<CrmUiResult<NoteVm[]>>;
  createNote(contactId: string, content: string): Promise<CrmUiResult<NoteVm>>;
  parseImportFile(file: File): Promise<CrmUiResult<ParsedImport>>;
  previewImport(
    rows: JsonRow[],
    mapping: ContactFieldMapping,
  ): Promise<CrmUiResult<ContactsImportPreview>>;
  importContacts(input: ContactsImportInput): Promise<CrmUiResult<ContactsImportResult>>;
}

export interface ContactsScreenProps {
  adapter: ContactsAdapter;
  capabilities: CrmCapabilities;
  navigation: CrmNavigation;
  className?: string;
}

export interface ContactFormScreenProps extends ContactsScreenProps {
  mode: "create" | "edit";
  contactId?: string;
}

export interface ContactDetailScreenProps extends ContactsScreenProps {
  contactId: string;
  quickActions?: ReactNode;
}

export type ContactImportScreenProps = ContactsScreenProps;
