/**
 * Attachment reads over the injected store (pure).
 *
 * Upload, deletion, and signed-URL issuance are storage transports and
 * live in the host; the domain only exposes the listing operation.
 */
import type { SupportTicketAttachment } from "@tindevelopers/core-kernel/support";
import type { SupportStore } from "./store";

/** List the attachments of a ticket. */
export async function listAttachments(
  store: SupportStore,
  ticketId: string,
): Promise<SupportTicketAttachment[]> {
  return store.listAttachments(ticketId);
}
