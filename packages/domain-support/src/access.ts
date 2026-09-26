/**
 * Support access grants (pure).
 *
 * Staff above an owner (its partner, or the platform) read that owner's
 * tickets only through a grant: consented, time-boxed, read-only, and logged
 * on every read. The database enforces these same limits; this module lets a
 * host reject bad input early and show a grant's state.
 */
import type { SupportOwnerScope } from "./types";

export const SUPPORT_ACCESS_MIN_HOURS = 1;
export const SUPPORT_ACCESS_MAX_HOURS = 168;
export const SUPPORT_ACCESS_DEFAULT_HOURS = 24;
export const SUPPORT_BREAK_GLASS_HOURS = 1;
export const SUPPORT_BREAK_GLASS_MIN_REASON = 20;

export type SupportAccessGranteeScope = "partner" | "platform";
export type SupportAccessKind = "request" | "grant" | "break_glass";
export type SupportAccessStatus = "pending" | "approved" | "denied" | "revoked";
export type SupportAccessState = "pending" | "active" | "expired" | "denied" | "revoked";
export type SupportAccessAction = "list_tickets" | "view_ticket" | "download_attachment";

export interface SupportAccessGrant {
  id: string;
  owner_scope: Exclude<SupportOwnerScope, "platform">;
  tenant_id: string | null;
  partner_id: string | null;
  grantee_scope: SupportAccessGranteeScope;
  grantee_partner_id: string | null;
  /** Null means the whole queue. */
  ticket_id: string | null;
  kind: SupportAccessKind;
  status: SupportAccessStatus;
  reason: string;
  requested_hours: number;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  starts_at: string | null;
  expires_at: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
}

export interface SupportAccessEvent {
  id: string;
  grant_id: string;
  actor_id: string;
  action: SupportAccessAction;
  ticket_id: string | null;
  attachment_id: string | null;
  created_at: string;
}

/** A grant's effective state at `now`: approved grants expire by time alone. */
export function accessGrantState(
  grant: Pick<SupportAccessGrant, "status" | "starts_at" | "expires_at">,
  now: Date = new Date(),
): SupportAccessState {
  if (grant.status !== "approved") return grant.status;
  const starts = grant.starts_at ? Date.parse(grant.starts_at) : NaN;
  const expires = grant.expires_at ? Date.parse(grant.expires_at) : NaN;
  const t = now.getTime();
  return Number.isFinite(starts) && Number.isFinite(expires) && starts <= t && t < expires
    ? "active"
    : "expired";
}

/** Returns an error message, or null when the input is acceptable. */
export function validateAccessRequest(input: {
  reason: string;
  hours?: number;
  breakGlass?: boolean;
}): string | null {
  const reason = input.reason.trim();
  if (input.breakGlass) {
    return reason.length >= SUPPORT_BREAK_GLASS_MIN_REASON
      ? null
      : `Break-glass needs a reason of at least ${SUPPORT_BREAK_GLASS_MIN_REASON} characters.`;
  }
  if (!reason) return "A reason is required.";
  const hours = input.hours ?? SUPPORT_ACCESS_DEFAULT_HOURS;
  if (!Number.isInteger(hours) || hours < SUPPORT_ACCESS_MIN_HOURS || hours > SUPPORT_ACCESS_MAX_HOURS) {
    return `Access lasts ${SUPPORT_ACCESS_MIN_HOURS} to ${SUPPORT_ACCESS_MAX_HOURS} hours.`;
  }
  return null;
}
