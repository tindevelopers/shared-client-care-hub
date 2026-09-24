/**
 * Support tenant-resolution policy (pure).
 *
 * The host resolves the actor's own tenant id from server-controlled
 * records and injects it here; the domain owns only the decision, and the
 * decision is fail-closed: act only in the actor's resolved tenant, or
 * refuse. There is no platform-operator branch — a platform staffer reaches
 * a customer tenant through a support session (impersonation), which
 * resolves a normal `currentTenantId` like any other actor; the domain
 * needs no special case for it. Nothing here may pick an arbitrary tenant
 * on the actor's behalf. The error message prefix ("No tenant found") is
 * stable — hosts may branch on it for empty-state handling.
 */
export interface SupportTenantContext {
  /** The actor's own tenant id, when their record carries one. */
  currentTenantId: string | null;
}

/**
 * Resolve the tenant a support operation acts for: the actor's own tenant,
 * or fail closed. There is no fallback to "some other tenant" — a caller
 * with no resolved tenant scope gets a thrown error, never a guess.
 */
export function resolveSupportTenantId(context: SupportTenantContext): string {
  if (context.currentTenantId) {
    return context.currentTenantId;
  }

  throw new Error(
    "No tenant found. Please ensure you are associated with a tenant. " +
      "If you are a Platform Admin, please create a tenant first in Tenant Management.",
  );
}
