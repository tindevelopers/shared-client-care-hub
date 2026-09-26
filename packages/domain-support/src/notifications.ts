/**
 * Support notification decisions and templates (pure).
 *
 * The domain decides WHICH notification goes out, to WHICH recipient role,
 * and renders the escaped subject/html/text. Transport is injected
 * (`SupportNotificationSender`); the host implements it with the existing
 * `@tindevelopers/core-kernel/email` service and resolves recipient roles
 * (customer / assignee / owner_queue) to concrete addresses.
 *
 * `owner_queue` is the agents of the ticket's owner (its group, or the
 * whole queue). Escalation notifications only ever go to agents: a
 * requester is told about progress by its own owner, never by an upstream
 * organization.
 */
import { ownerOf, type SupportOwner, type SupportTicket, type SupportTicketThread } from "./types";

/** Recipient role — the host resolves it to concrete addresses. */
export type SupportNotificationRecipient = "customer" | "assignee" | "owner_queue";

export type SupportNotificationType =
  | "ticket_created"
  | "ticket_updated"
  | "ticket_escalated"
  | "ticket_returned"
  | "upstream_resolved"
  | "ticket_reply";

/** A fully rendered notification; the sender only transports it. */
export interface SupportNotification {
  type: SupportNotificationType;
  recipient: SupportNotificationRecipient;
  ticketId: string;
  owner: SupportOwner;
  subject: string;
  html: string;
  text: string;
}

/** Transport seam — the host implements this (core-kernel/email). */
export interface SupportNotificationSender {
  send(input: SupportNotification): Promise<void>;
}

/** Fields whose change triggers a ticket_updated notification. */
export interface SupportTicketChanges {
  status?: string;
  priority?: string;
  assigned_to?: string;
}

/** Escape interpolated values so ticket content can never inject markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function notification(
  type: SupportNotificationType,
  recipient: SupportNotificationRecipient,
  ticket: SupportTicket,
  content: { subject: string; html: string; text: string },
): SupportNotification {
  return {
    type,
    recipient,
    ticketId: ticket.id,
    owner: ownerOf(ticket),
    ...content,
  };
}

function descriptionBlock(ticket: SupportTicket): { html: string; text: string } {
  if (!ticket.description) return { html: "", text: "" };
  return {
    html: `<p><strong>Description:</strong><br>${escapeMultiline(ticket.description)}</p>`,
    text: `Description: ${ticket.description}`,
  };
}

/** Ticket created → customer, plus the assignee when one is set. */
export function buildTicketCreatedNotifications(ticket: SupportTicket): SupportNotification[] {
  const description = descriptionBlock(ticket);
  const out: SupportNotification[] = [
    notification("ticket_created", "customer", ticket, {
      subject: `Support Ticket Created: ${ticket.ticket_number}`,
      html: `
        <h2>Your support ticket has been created</h2>
        <p>Hello ${escapeHtml(ticket.created_by_user?.full_name || "there")},</p>
        <p>Your support ticket <strong>${escapeHtml(ticket.ticket_number)}</strong> has been created successfully.</p>
        <p><strong>Subject:</strong> ${escapeHtml(ticket.subject)}</p>
        <p><strong>Status:</strong> ${escapeHtml(ticket.status)}</p>
        <p><strong>Priority:</strong> ${escapeHtml(ticket.priority)}</p>
        ${description.html}
        <p>We'll get back to you soon!</p>
      `,
      text: `
        Your support ticket ${ticket.ticket_number} has been created successfully.
        Subject: ${ticket.subject}
        Status: ${ticket.status}
        Priority: ${ticket.priority}
        ${description.text}
      `,
    }),
  ];
  if (ticket.assigned_to) {
    const customer = ticket.created_by_user?.full_name || ticket.created_by_user?.email || "the customer";
    out.push(
      notification("ticket_created", "assignee", ticket, {
        subject: `New Support Ticket Assigned: ${ticket.ticket_number}`,
        html: `
          <h2>New support ticket assigned to you</h2>
          <p>Hello ${escapeHtml(ticket.assigned_to_user?.full_name || "there")},</p>
          <p>A new support ticket <strong>${escapeHtml(ticket.ticket_number)}</strong> has been assigned to you.</p>
          <p><strong>Subject:</strong> ${escapeHtml(ticket.subject)}</p>
          <p><strong>Customer:</strong> ${escapeHtml(customer)}</p>
          <p><strong>Priority:</strong> ${escapeHtml(ticket.priority)}</p>
          ${description.html}
        `,
        text: `
          A new support ticket ${ticket.ticket_number} has been assigned to you.
          Subject: ${ticket.subject}
          Customer: ${customer}
          Priority: ${ticket.priority}
          ${description.text}
        `,
      }),
    );
  }
  return out;
}

/** Ticket updated → customer, only when a tracked field actually changed. */
export function buildTicketUpdatedNotifications(
  ticket: SupportTicket,
  changes: SupportTicketChanges,
): SupportNotification[] {
  const changeMessages: string[] = [];
  if (changes.status) changeMessages.push(`Status changed to: ${changes.status}`);
  if (changes.priority) changeMessages.push(`Priority changed to: ${changes.priority}`);
  if (changes.assigned_to) {
    const agentName = ticket.assigned_to_user?.full_name || "Agent";
    changeMessages.push(`Assigned to: ${agentName}`);
  }
  if (changeMessages.length === 0) return [];

  return [
    notification("ticket_updated", "customer", ticket, {
      subject: `Support Ticket Updated: ${ticket.ticket_number}`,
      html: `
        <h2>Your support ticket has been updated</h2>
        <p>Hello ${escapeHtml(ticket.created_by_user?.full_name || "there")},</p>
        <p>Your support ticket <strong>${escapeHtml(ticket.ticket_number)}</strong> has been updated:</p>
        <ul>
          ${changeMessages.map((msg) => `<li>${escapeHtml(msg)}</li>`).join("")}
        </ul>
        <p><strong>Subject:</strong> ${escapeHtml(ticket.subject)}</p>
      `,
      text: `
        Your support ticket ${ticket.ticket_number} has been updated:
        ${changeMessages.join("\n")}
        Subject: ${ticket.subject}
      `,
    }),
  ];
}

/** An escalation arrived in this owner's queue → owner_queue of the upstream ticket. */
export function buildTicketEscalatedNotifications(
  upstream: SupportTicket,
  fromOwnerLabel: string,
): SupportNotification[] {
  const supportCode = upstream.support_code
    ? `<p><strong>Support code:</strong> ${escapeHtml(upstream.support_code)}</p>`
    : "";
  return [
    notification("ticket_escalated", "owner_queue", upstream, {
      subject: `Ticket escalated to your queue: ${upstream.ticket_number}`,
      html: `
        <h2>Support ticket escalated</h2>
        <p>${escapeHtml(fromOwnerLabel)} escalated a ticket to your queue.</p>
        <p><strong>Ticket:</strong> ${escapeHtml(upstream.ticket_number)}</p>
        <p><strong>Subject:</strong> ${escapeHtml(upstream.subject)}</p>
        <p><strong>Priority:</strong> ${escapeHtml(upstream.priority)}</p>
        ${supportCode}
        <p>Please review the ticket in the support dashboard.</p>
      `,
      text: `${fromOwnerLabel} escalated ticket ${upstream.ticket_number} (${upstream.subject}) to your queue. Priority: ${upstream.priority}.`,
    }),
  ];
}

function downstreamRecipient(ticket: SupportTicket): SupportNotificationRecipient {
  return ticket.assigned_to ? "assignee" : "owner_queue";
}

/** Upstream sent an escalation back → the downstream ticket's assignee or queue. */
export function buildTicketReturnedNotifications(
  downstream: SupportTicket,
  upstreamTicketNumber: string,
  reason: string,
): SupportNotification[] {
  return [
    notification("ticket_returned", downstreamRecipient(downstream), downstream, {
      subject: `Escalation sent back: ${downstream.ticket_number}`,
      html: `
        <h2>Escalation sent back</h2>
        <p>Upstream ticket <strong>${escapeHtml(upstreamTicketNumber)}</strong> was sent back to ticket <strong>${escapeHtml(downstream.ticket_number)}</strong>.</p>
        <p><strong>Subject:</strong> ${escapeHtml(downstream.subject)}</p>
        <p><strong>Reason:</strong><br>${escapeMultiline(reason)}</p>
      `,
      text: `Upstream ticket ${upstreamTicketNumber} was sent back to ticket ${downstream.ticket_number} (${downstream.subject}). Reason: ${reason}`,
    }),
  ];
}

/** Upstream resolved an escalation → the downstream ticket's assignee or queue. */
export function buildUpstreamResolvedNotifications(
  downstream: SupportTicket,
  upstreamTicketNumber: string,
  resolution: string,
): SupportNotification[] {
  return [
    notification("upstream_resolved", downstreamRecipient(downstream), downstream, {
      subject: `Escalation resolved: ${downstream.ticket_number}`,
      html: `
        <h2>Escalation resolved</h2>
        <p>Upstream ticket <strong>${escapeHtml(upstreamTicketNumber)}</strong> was resolved. Please confirm with the requester of ticket <strong>${escapeHtml(downstream.ticket_number)}</strong>.</p>
        <p><strong>Subject:</strong> ${escapeHtml(downstream.subject)}</p>
        <p><strong>Resolution:</strong><br>${escapeMultiline(resolution)}</p>
      `,
      text: `Upstream ticket ${upstreamTicketNumber} was resolved. Confirm with the requester of ticket ${downstream.ticket_number} (${downstream.subject}). Resolution: ${resolution}`,
    }),
  ];
}

/**
 * Ticket reply → the other party. Agent replies notify the customer;
 * customer replies notify the assignee (only when one is set). Internal
 * notes never produce a notification.
 */
export function buildTicketReplyNotifications(
  ticket: SupportTicket,
  thread: SupportTicketThread,
  isAgentReply: boolean,
): SupportNotification[] {
  if (thread.is_internal) return [];

  if (isAgentReply) {
    return [
      notification("ticket_reply", "customer", ticket, {
        subject: `New Reply on Support Ticket: ${ticket.ticket_number}`,
        html: `
          <h2>New reply on your support ticket</h2>
          <p>Hello ${escapeHtml(ticket.created_by_user?.full_name || "there")},</p>
          <p>You have received a new reply on support ticket <strong>${escapeHtml(ticket.ticket_number)}</strong>.</p>
          <p><strong>Subject:</strong> ${escapeHtml(ticket.subject)}</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            ${escapeMultiline(thread.message)}
          </div>
          <p>You can view and reply to this ticket in your support portal.</p>
        `,
        text: `
          New reply on your support ticket ${ticket.ticket_number}
          Subject: ${ticket.subject}

          ${thread.message}
        `,
      }),
    ];
  }

  if (!ticket.assigned_to) return [];
  return [
    notification("ticket_reply", "assignee", ticket, {
      subject: `New Customer Reply on Ticket: ${ticket.ticket_number}`,
      html: `
        <h2>New customer reply</h2>
        <p>A customer has replied to support ticket <strong>${escapeHtml(ticket.ticket_number)}</strong>.</p>
        <p><strong>Subject:</strong> ${escapeHtml(ticket.subject)}</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          ${escapeMultiline(thread.message)}
        </div>
      `,
      text: `
        New customer reply on ticket ${ticket.ticket_number}
        Subject: ${ticket.subject}

        ${thread.message}
      `,
    }),
  ];
}

/**
 * Deliver rendered notifications through the injected sender. A transport
 * failure must never break the triggering operation (ticket creation,
 * update, reply) — errors are logged and swallowed, per notification.
 */
export async function sendNotifications(
  sender: SupportNotificationSender,
  notifications: readonly SupportNotification[],
): Promise<void> {
  for (const item of notifications) {
    try {
      await sender.send(item);
    } catch (error) {
      console.error(`Failed to send ${item.type} notification for ticket ${item.ticketId}:`, error);
    }
  }
}
