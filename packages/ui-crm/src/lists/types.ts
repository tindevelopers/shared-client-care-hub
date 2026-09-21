import type { ContactGroupRow } from "@tindevelopers/schema-crm";
import type { ContactPage, ContactQuery, ContactSummaryVm } from "../contacts/types.js";
import type { Page } from "../core/result.js";

export interface ListQuery {
  search?: string;
  limit: number;
  offset: number;
}

export type ContactListVm = ContactGroupRow & { memberCount: number };
export type ContactListPage = Page<ContactListVm>;
export type ContactListDetailVm = ContactListVm & {
  members: Page<ContactSummaryVm>;
};
export type ContactListInput = Pick<
  ContactGroupRow,
  "name" | "description" | "color" | "kind" | "definition"
>;
export type ContactListPatch = Partial<ContactListInput>;

export type { ContactPage, ContactQuery };
