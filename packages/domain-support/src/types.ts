/**
 * Support domain model (pure types).
 *
 * Every ticket, thread, attachment, category and group is owned by exactly
 * one owner: a tenant, a partner (agency), or the platform. The row shape
 * mirrors the host tables (`owner_scope` + nullable `tenant_id`/`partner_id`,
 * constrained to exactly one owner).
 */

export type SupportOwnerScope = "tenant" | "partner" | "platform";

export type SupportOwner =
  | { scope: "tenant"; tenantId: string }
  | { scope: "partner"; partnerId: string }
  | { scope: "platform" };

/** The owner columns every support row carries. */
export interface SupportOwnedRow {
  owner_scope: SupportOwnerScope;
  tenant_id: string | null;
  partner_id: string | null;
}

export type TicketStatus =
  | "open"
  | "in_progress"
  | "waiting_on_customer"
  | "waiting_on_upstream"
  | "resolved"
  | "closed";

export type TicketPriority = "low" | "medium" | "high" | "urgent";

export interface SupportUserRef {
  id: string;
  full_name: string;
  email: string;
  avatar_url?: string | null;
}

export interface SupportCategory extends SupportOwnedRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** A tier inside one owner (client care, technical support, programmer). */
export interface SupportGroup extends SupportOwnedRow {
  id: string;
  name: string;
  /** Escalation order inside the owner, lowest first. */
  rank: number;
  is_active: boolean;
  created_at: string;
}

export interface SupportTicket extends SupportOwnedRow {
  id: string;
  ticket_number: string;
  subject: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  category_id: string | null;
  group_id: string | null;
  created_by: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  /** Public support code when the ticket came from a failed action (e.g. KX-NUM-004). */
  support_code?: string | null;
  /** Reference id from the error (e.g. ref_xxx). */
  support_ref?: string | null;
  category?: SupportCategory | null;
  created_by_user?: SupportUserRef | null;
  assigned_to_user?: SupportUserRef | null;
}

export interface SupportTicketThread extends SupportOwnedRow {
  id: string;
  ticket_id: string;
  user_id: string;
  message: string;
  is_internal: boolean;
  created_at: string;
  updated_at: string;
  user?: SupportUserRef | null;
}

export interface SupportTicketAttachment extends SupportOwnedRow {
  id: string;
  ticket_id: string;
  thread_id: string | null;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string;
  created_at: string;
}

export type SupportLinkKind = "escalation" | "merge";
export type SupportLinkState = "active" | "resolved" | "returned" | "withdrawn";

/** What crossed an organization boundary on escalation (kept for audit). */
export interface EscalationShared {
  fields: string[];
  requester_contact: boolean;
  description_edited: boolean;
  thread_ids: string[];
  attachment_ids: string[];
}

/**
 * A link between two tickets. `escalation`: `from` waits on `to`.
 * `merge`: `from` (a duplicate) was merged into `to` (the master).
 * `provider`/`external_id` are reserved for specialist systems outside
 * Konnect and are unused until specialist escalation is added.
 */
export interface SupportTicketLink {
  id: string;
  kind: SupportLinkKind;
  from_ticket_id: string;
  to_ticket_id: string | null;
  provider: string | null;
  external_id: string | null;
  state: SupportLinkState;
  shared: EscalationShared | Record<string, never>;
  resolution: string | null;
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

/** One status change from the ticket history. */
export interface SupportStatusEvent {
  status: TicketStatus;
  at: string;
}

export interface CreateTicketInput {
  subject: string;
  description?: string;
  priority?: TicketPriority;
  category_id?: string;
  group_id?: string;
  assigned_to?: string;
  /** When the ticket is created from a failed user action. */
  support_code?: string;
  support_ref?: string;
}

export interface UpdateTicketInput {
  subject?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  category_id?: string;
  /** Tier escalation inside the owner: move the ticket to another group. */
  group_id?: string;
  assigned_to?: string;
}

/** Read the owner of any support row; rejects rows that break the one-owner rule. */
export function ownerOf(row: SupportOwnedRow): SupportOwner {
  if (row.owner_scope === "tenant" && row.tenant_id && !row.partner_id) {
    return { scope: "tenant", tenantId: row.tenant_id };
  }
  if (row.owner_scope === "partner" && row.partner_id && !row.tenant_id) {
    return { scope: "partner", partnerId: row.partner_id };
  }
  if (row.owner_scope === "platform" && !row.tenant_id && !row.partner_id) {
    return { scope: "platform" };
  }
  throw new Error(
    `Support row has an invalid owner (owner_scope "${row.owner_scope}", tenant_id ${row.tenant_id ?? "null"}, partner_id ${row.partner_id ?? "null"}).`,
  );
}

/** The owner columns for a new row owned by `owner`. */
export function ownerColumns(owner: SupportOwner): SupportOwnedRow {
  switch (owner.scope) {
    case "tenant":
      return { owner_scope: "tenant", tenant_id: owner.tenantId, partner_id: null };
    case "partner":
      return { owner_scope: "partner", tenant_id: null, partner_id: owner.partnerId };
    case "platform":
      return { owner_scope: "platform", tenant_id: null, partner_id: null };
  }
}

export function sameOwner(a: SupportOwner, b: SupportOwner): boolean {
  if (a.scope === "tenant" && b.scope === "tenant") return a.tenantId === b.tenantId;
  if (a.scope === "partner" && b.scope === "partner") return a.partnerId === b.partnerId;
  return a.scope === "platform" && b.scope === "platform";
}
