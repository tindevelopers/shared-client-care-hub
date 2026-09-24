/**
 * Support domain types (pure).
 *
 * Row shapes come from `@tindevelopers/schema-support` — the schema package
 * is ground truth for what the five support tables actually contain. The
 * optional `category`/`created_by_user`/`assigned_to_user`/`user`/
 * `uploaded_by_user` joins mirror the query shape the concrete stores select
 * (see `./stores`); a store that cannot populate them degrades notification
 * personalization to generic greetings, same as before.
 */
import type {
  SupportCategoryRow,
  SupportTicketAttachmentRow,
  SupportTicketPriority,
  SupportTicketRow,
  SupportTicketStatus,
  SupportTicketThreadRow,
} from "@tindevelopers/schema-support";

export type TicketStatus = SupportTicketStatus;
export type TicketPriority = SupportTicketPriority;

/** The subset of `users` columns the ticket/thread/attachment joins select. */
export interface SupportUserRef {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
}

export type SupportCategory = SupportCategoryRow;

export interface SupportTicket extends SupportTicketRow {
  category?: SupportCategory | null;
  created_by_user?: SupportUserRef | null;
  assigned_to_user?: SupportUserRef | null;
}

export interface SupportTicketThread extends SupportTicketThreadRow {
  user?: SupportUserRef | null;
}

export interface SupportTicketAttachment extends SupportTicketAttachmentRow {
  uploaded_by_user?: Omit<SupportUserRef, "avatar_url"> | null;
}

/** Ticket draft accepted by the conversation-to-ticket handoff seam. */
export interface CreateTicketInput {
  subject: string;
  description?: string;
  priority?: TicketPriority;
  category_id?: string;
  assigned_to?: string;
  /** When ticket is created from a failed user action */
  support_code?: string;
  support_ref?: string;
}

export interface UpdateTicketInput {
  subject?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  category_id?: string;
  assigned_to?: string;
  /** Set to escalate ticket to platform admin (e.g. new Date().toISOString()) */
  escalated_to_platform_admin_at?: string | null;
}

export interface CreateCategoryInput {
  name: string;
  description?: string | null;
  is_active?: boolean;
}
