import type {
  ContactSuppressionRow,
  SuppressionChannel,
} from "@tindevelopers/schema-crm";
import type { ContactSummaryVm } from "../contacts/types.js";
import type { Page } from "../core/result.js";

export interface SuppressionQuery {
  search?: string;
  channel?: SuppressionChannel;
  suppressed?: boolean;
  limit: number;
  offset: number;
}

export type ContactSuppressionVm = ContactSuppressionRow & {
  contact: ContactSummaryVm;
};
export type ContactSuppressionPage = Page<ContactSuppressionVm>;
export type SetSuppressionInput = Pick<
  ContactSuppressionRow,
  "contact_id" | "channel" | "suppressed" | "reason" | "source" | "metadata"
>;
export type BulkSetSuppressionInput = Omit<SetSuppressionInput, "contact_id"> & {
  contactIds: string[];
};
