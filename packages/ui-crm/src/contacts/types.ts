import type { ContactRow } from "@tindevelopers/schema-crm";
import type { Page } from "../core/result.js";

export interface ContactQuery {
  search?: string;
  tag?: string;
  limit: number;
  offset: number;
}

export type ContactSummaryVm = Pick<
  ContactRow,
  | "id"
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "mobile"
  | "job_title"
  | "tags"
  | "sms_opt_out"
  | "email_opt_out"
  | "whatsapp_opt_out"
  | "updated_at"
> & { companyName: string | null };

export type ContactPage = Page<ContactSummaryVm>;

export type ContactDetailVm = ContactSummaryVm &
  Pick<
    ContactRow,
    | "company_id"
    | "department"
    | "address"
    | "avatar_url"
    | "custom_fields"
    | "notes"
    | "created_at"
    | "dnc"
  >;

export type ContactInput = Pick<ContactRow, "first_name" | "last_name"> &
  Partial<
    Pick<
      ContactRow,
      | "company_id"
      | "email"
      | "phone"
      | "mobile"
      | "job_title"
      | "department"
      | "address"
      | "avatar_url"
      | "tags"
      | "custom_fields"
      | "notes"
    >
  >;

export type ContactPatch = Partial<ContactInput>;

export interface ActivityVm {
  id: string;
  type: string;
  title: string;
  description: string | null;
  createdAt: string;
}

export interface NoteVm {
  id: string;
  content: string;
  createdAt: string;
  createdByLabel: string | null;
}

export type JsonRow = Record<string, string | number | boolean | null>;
export type ContactFieldMapping = Record<string, keyof ContactInput | "ignore">;

export interface ParsedImport {
  rows: JsonRow[];
  columns: string[];
}

export interface ContactsImportPreview {
  valid: number;
  invalid: number;
  errors: string[];
}

export interface ContactsImportInput {
  rows: JsonRow[];
  mapping: ContactFieldMapping;
}

export interface ContactsImportResult {
  imported: number;
  skipped: number;
}
