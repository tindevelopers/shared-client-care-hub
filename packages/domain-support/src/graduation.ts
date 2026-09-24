/**
 * Support graduation core (Pass C — Task C5).
 *
 * The thin layer is always the system of record (R2):
 *   1. write the first-party ticket/thread FIRST, unconditionally
 *   2. then, if a specialist is bound, attempt the specialist write
 *   3. success → merge externalRefs onto the first-party row
 *      failure → syncState 'error' + dead-letter, and STILL return success
 *
 * A specialist outage must never block a tenant. This module is pure and
 * dependency-injected; the server wiring lives in graduation-server.ts.
 * It imports only the PORT type from @tindevelopers/adapter-kit (R1 —
 * the domain never imports a vendor SDK or a vendor type).
 */
import type { SupportProvider, SupportTicket } from "@tindevelopers/adapter-kit";
import type { ExternalRefs, SyncState } from "@tindevelopers/adapter-kit";

/** First-party row as stored by base-core repositories. */
export interface FirstPartyTicket {
  id: string;
  tenant_id: string;
  ticket_number: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  requester_email?: string | null;
  created_at: string;
  external_refs?: ExternalRefs | null;
  sync_state?: SyncState | null;
}

/** Storage seam — the host wiring implements this against real tables. */
export interface GraduationStore {
  insertTicket(input: unknown, tenantId: string): Promise<FirstPartyTicket>;
  mergeExternalRefs(tenantId: string, ticketId: string, refs: ExternalRefs): Promise<void>;
  setSyncState(tenantId: string, ticketId: string, state: SyncState): Promise<void>;
  /** The store resolves the binding row itself; it owns the SQL. */
  deadLetter(
    tenantId: string,
    provider: string,
    idempotencyKey: string,
    payload: unknown,
    error: unknown,
  ): Promise<void>;
  insertThread(tenantId: string, ticketId: string, thread: { message: string; userId: string }): Promise<unknown>;
  getTicketById(tenantId: string, ticketId: string): Promise<FirstPartyTicket | null>;
}

/**
 * A bound specialist paired with its canonical provider name. The name is
 * the `external_refs` key — graduation resolves specialist identifiers
 * generically through it, never through provider-specific branches.
 */
export interface ResolvedSupportProvider {
  name: string;
  port: SupportProvider;
}

export interface SupportGraduationDeps {
  /** Registry (C4): null when no enabled binding — thin layer standalone. */
  resolveProvider(tenantId: string, capability: "support"): Promise<ResolvedSupportProvider | null>;
  store: GraduationStore;
}

export interface GraduatedTicket extends FirstPartyTicket {
  externalRefs: ExternalRefs;
  syncState: SyncState;
}

// ── Vocabulary translation (first-party ↔ canonical port) ─────────────────
// The port vocabulary is the published contract; adapter-kit 1.6.0 aligned
// it with first-party storage ('in_progress', 'medium'). The maps stay as
// the single translation point and fall back safely on unknown values. The
// trailing casts keep this module compiling against both the published 1.x
// line and the 1.6.0 renamed literals, which are the target contract.

const STATUS_TO_CANONICAL: Record<string, string> = {
  open: "open",
  in_progress: "in_progress",
  resolved: "resolved",
  closed: "closed",
};

const PRIORITY_TO_CANONICAL: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  urgent: "urgent",
};

/** Project a first-party row onto the canonical port shape. */
export function toCanonicalTicket(t: FirstPartyTicket): SupportTicket {
  return {
    id: t.id,
    tenantId: t.tenant_id,
    subject: t.subject,
    body: t.description ?? "",
    status: (STATUS_TO_CANONICAL[t.status] ?? "open") as SupportTicket["status"],
    priority: (PRIORITY_TO_CANONICAL[t.priority] ?? "medium") as SupportTicket["priority"],
    requesterEmail: t.requester_email ?? "support@internal.invalid",
    createdAt: t.created_at,
    updatedAt: t.created_at,
    externalRefs: t.external_refs ?? {},
    syncState: t.sync_state ?? { status: "clean" },
  };
}

/** Create a ticket: first-party always, specialist best-effort. */
export async function createTicketGraduated(
  deps: SupportGraduationDeps,
  input: unknown,
  tenantId: string,
): Promise<GraduatedTicket> {
  // 1. First-party write — the system of record. Never skipped.
  const ticket = await deps.store.insertTicket(input, tenantId);

  const externalRefs: ExternalRefs = ticket.external_refs ?? {};
  const syncState: SyncState = ticket.sync_state ?? { status: "clean" };

  // 2. Specialist write — only when a binding resolves. A registry
  //    failure must never block the tenant.
  const provider = await deps.resolveProvider(tenantId, "support").catch(() => null);
  if (!provider) {
    return { ...ticket, externalRefs, syncState };
  }

  try {
    const synced = await provider.port.create(
      toCanonicalTicket({ ...ticket, external_refs: externalRefs, sync_state: syncState }),
    );
    const refs = (synced as SupportTicket).externalRefs ?? {};
    await deps.store.mergeExternalRefs(tenantId, ticket.id, refs);
    return {
      ...ticket,
      externalRefs: { ...externalRefs, ...refs },
      syncState: { ...syncState, status: "clean" },
    };
  } catch (err) {
    // 3. Outage isolation: dead-letter, mark, and STILL succeed.
    const message = err instanceof Error ? err.message : String(err);
    await deps.store.setSyncState(tenantId, ticket.id, { ...syncState, status: "error", lastError: message });
    await deps.store.deadLetter(tenantId, "support", `ticket:${ticket.id}:create`, { ticketId: ticket.id }, err);
    return {
      ...ticket,
      externalRefs,
      syncState: { ...syncState, status: "error", lastError: message },
    };
  }
}

/** Add a reply thread: first-party always, specialist best-effort. */
export async function addThreadGraduated(
  deps: SupportGraduationDeps,
  tenantId: string,
  ticketId: string,
  thread: { message: string; userId: string; authorEmail: string },
): Promise<unknown> {
  // 1. First-party thread — always.
  const created = await deps.store.insertThread(tenantId, ticketId, {
    message: thread.message,
    userId: thread.userId,
  });

  const ticket = await deps.store.getTicketById(tenantId, ticketId);
  if (!ticket) return;

  const provider = await deps.resolveProvider(tenantId, "support").catch(() => null);
  if (!provider) return;

  // No specialist record yet (backfill pending or push failed): skip.
  // Generic lookup: the bound provider's canonical name IS the refs key —
  // no provider-specific branches (design rule R1/R2).
  const externalId = ticket.external_refs?.[provider.name]?.id;
  if (!externalId) return;

  try {
    await provider.port.addThread(externalId, thread.message, thread.authorEmail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.store.setSyncState(tenantId, ticketId, { status: "error", lastError: message });
    await deps.store.deadLetter(
      tenantId,
      "support",
      `ticket:${ticketId}:thread:${Date.now()}`,
      { ticketId, message: thread.message },
      err,
    );
  }
  return created;
}
