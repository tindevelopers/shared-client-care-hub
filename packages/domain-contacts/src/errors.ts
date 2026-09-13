/**
 * Domain errors for the contacts store.
 *
 * Message semantics are byte-preserving ports of the current writers:
 * W4 (`apps/app/app/actions/crm/contacts.ts` createContact) throws
 * `A contact with email "<email>" already exists.` on Postgres 23505.
 */

/** Duplicate tenant email — Postgres 23505 on `contacts_tenant_email_unique`. */
export class DuplicateEmailError extends Error {
  readonly email: string | null;

  constructor(email: string | null, options?: ErrorOptions) {
    super(`A contact with email "${email}" already exists.`, options);
    this.name = "DuplicateEmailError";
    this.email = email;
  }
}

/** Contact id not found within the store's tenant scope. */
export class ContactNotFoundError extends Error {
  constructor(message = "Contact not found.", options?: ErrorOptions) {
    super(message, options);
    this.name = "ContactNotFoundError";
  }
}

/**
 * A system-tier method was called without a tenant scope. System-tier
 * writers take an explicit `tenantId` on every call (hardening over the
 * id-only service-role writers they absorb).
 */
export class TenantIdRequiredError extends Error {
  constructor(options?: ErrorOptions) {
    super("tenantId is required.", options);
    this.name = "TenantIdRequiredError";
  }
}

/**
 * A segment definition filters on `lifecycleStage`, which has no backing
 * column on the hosted schema (ground-truth drift: `contacts.lifecycle_stage`
 * does not exist — querying it provokes Postgres 42703). The segment
 * materializer throws this BEFORE any DB call instead of crashing at the
 * query.
 */
export class LifecycleStageUnsupportedError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "Segment filtering by lifecycleStage is not supported: contacts.lifecycle_stage does not exist on the hosted schema.",
      options,
    );
    this.name = "LifecycleStageUnsupportedError";
  }
}
