/**
 * Upstream escalation rules (pure).
 *
 * The host resolves an owner's parent (subtenant → parent tenant,
 * tenant → partner or platform, partner → platform) through
 * `SupportOwnerChain`; the domain validates the hop and builds the copy of
 * the ticket that crosses the boundary. Nothing identifying the requester,
 * no reply, no internal note and no attachment crosses unless the
 * escalating agent chose it.
 */
import {
  ownerColumns,
  sameOwner,
  type EscalationShared,
  type SupportOwner,
  type SupportTicket,
  type SupportTicketAttachment,
  type SupportTicketThread,
} from "./types";

/** Host-implemented: the next owner up the chain, or null at the top. */
export interface SupportOwnerChain {
  parentOf(owner: SupportOwner): Promise<SupportOwner | null>;
}

/**
 * Validate the only allowed escalation target: the owner's direct parent.
 * Levels are never skipped, the platform is the top of the chain, and a
 * partner can only escalate to the platform.
 */
export function selectEscalationTarget(
  current: SupportOwner,
  parent: SupportOwner | null,
): SupportOwner {
  if (current.scope === "platform" || !parent) {
    throw new Error("This ticket's owner is the top of the support chain; there is no one to escalate to.");
  }
  if (sameOwner(current, parent)) {
    throw new Error("A ticket cannot be escalated to its own owner.");
  }
  if (current.scope === "partner" && parent.scope !== "platform") {
    throw new Error(`A partner can only escalate to the platform, not to a ${parent.scope}.`);
  }
  return parent;
}

/** The escalating agent's choices on the share form. */
export interface EscalationShareChoices {
  /** Replacement for the customer-facing description; the original is sent when omitted. */
  description?: string;
  includeRequesterContact?: boolean;
  threadIds?: readonly string[];
  attachmentIds?: readonly string[];
}

/**
 * The upstream ticket to create. The host adds `id`, `ticket_number` and
 * timestamps, copies `attachment_ids`, appends `threads` as internal notes,
 * and moves the downstream ticket to `waiting_on_upstream` in the same
 * transaction.
 */
export interface UpstreamTicketDraft {
  ticket: Omit<
    SupportTicket,
    "id" | "ticket_number" | "created_at" | "updated_at" | "category" | "created_by_user" | "assigned_to_user"
  >;
  threads: { message: string; is_internal: true }[];
  attachment_ids: string[];
}

export interface BuildUpstreamTicketInput {
  ticket: SupportTicket;
  /** Every thread of the downstream ticket (to validate the selection). */
  threads: readonly SupportTicketThread[];
  /** Every attachment of the downstream ticket (to validate the selection). */
  attachments: readonly SupportTicketAttachment[];
  target: SupportOwner;
  actorId: string;
  /** Display name of the escalating owner, e.g. the tenant's name. */
  fromOwnerLabel: string;
  choices?: EscalationShareChoices;
}

/** Build the privacy-filtered upstream ticket and the record of what was shared. */
export function buildUpstreamTicket(input: BuildUpstreamTicketInput): {
  draft: UpstreamTicketDraft;
  shared: EscalationShared;
} {
  const { ticket, choices = {} } = input;
  const fields = ["subject", "description", "priority", "source_owner", "source_ticket_number"];

  const threads = pick(input.threads, choices.threadIds, "reply or note");
  const attachments = pick(input.attachments, choices.attachmentIds, "attachment");

  const lines = [
    choices.description ?? ticket.description ?? "",
    "",
    "---",
    `Escalated from ${input.fromOwnerLabel}, ticket ${ticket.ticket_number}.`,
  ];
  if (ticket.support_code) fields.push("support_code");
  if (ticket.support_ref) fields.push("support_ref");
  if (ticket.category?.name) {
    lines.push(`Category: ${ticket.category.name}`);
    fields.push("category_name");
  }
  if (choices.includeRequesterContact) {
    const requester = ticket.created_by_user;
    if (!requester) {
      throw new Error("Requester contact was requested but the ticket has no requester details loaded.");
    }
    lines.push(`Requester: ${requester.full_name} <${requester.email}>`);
    fields.push("requester_contact");
  }

  return {
    draft: {
      ticket: {
        ...ownerColumns(input.target),
        subject: ticket.subject,
        description: lines.join("\n").trimStart(),
        status: "open",
        priority: ticket.priority,
        category_id: null,
        group_id: null,
        created_by: input.actorId,
        assigned_to: null,
        support_code: ticket.support_code ?? null,
        support_ref: ticket.support_ref ?? null,
      },
      threads: threads.map((t) => ({ message: t.message, is_internal: true })),
      attachment_ids: attachments.map((a) => a.id),
    },
    shared: {
      fields,
      requester_contact: choices.includeRequesterContact === true,
      description_edited: choices.description !== undefined,
      thread_ids: threads.map((t) => t.id),
      attachment_ids: attachments.map((a) => a.id),
    },
  };
}

/** Select rows by id, rejecting any id that does not belong to this ticket. */
function pick<T extends { id: string }>(
  rows: readonly T[],
  ids: readonly string[] | undefined,
  label: string,
): T[] {
  if (!ids?.length) return [];
  return ids.map((id) => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`The selected ${label} "${id}" does not belong to this ticket.`);
    return row;
  });
}
