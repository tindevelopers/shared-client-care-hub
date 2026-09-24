/**
 * Support tenant-resolution policy (pure).
 *
 * The host resolves the actor's identity facts (own tenant, operator role,
 * first available tenant) from server-controlled records and injects them
 * here; the domain owns only the decision. Error message prefixes
 * ("No tenants found", "No tenant found") are stable — hosts may branch on
 * them for empty-state handling.
 */
export interface SupportTenantContext {
  /** The actor's own tenant id, when their record carries one. */
  currentTenantId: string | null;
  /** True when the actor holds a global operator role (tenant_id = NULL). */
  isSystemOperator: boolean;
  /** The earliest-created tenant an operator may act for, when one exists. */
  firstAvailableTenantId?: string | null;
}

/**
 * Resolve the tenant a support operation acts for:
 *   1. the actor's own tenant when present;
 *   2. for system operators, the first available tenant;
 *   3. otherwise fail closed.
 */
export function resolveSupportTenantId(context: SupportTenantContext): string {
  if (context.currentTenantId) {
    return context.currentTenantId;
  }

  if (context.isSystemOperator) {
    if (context.firstAvailableTenantId) {
      return context.firstAvailableTenantId;
    }
    throw new Error(
      "No tenants found. As a Platform Admin, you need to create a tenant first before creating support tickets. Please create a tenant in Tenant Management.",
    );
  }

  throw new Error(
    "No tenant found. Please ensure you are associated with a tenant. " +
      "If you are a Platform Admin, please create a tenant first in Tenant Management.",
  );
}
