import { z } from "zod";

/**
 * Zod schema for the `support_access_grants` table (Support access, option
 * C): a consented, time-boxed, read-only, logged grant letting an owner's
 * partner or the platform read that owner's tickets through the
 * SECURITY DEFINER functions in the same migration, never through a table
 * policy directly.
 *
 * Ground truth: konnect-caas-base
 * supabase/migrations/20260924120000_support_access_grants.sql (section 1).
 */

const timestamptz = z.string();
const uuid = z.string().uuid();

/**
 * `support_access_grants.owner_scope` CHECK — narrower than
 * `supportOwnerScopeSchema` (tickets/categories/etc.): never `'platform'`,
 * since nothing sits above the platform queue.
 */
export const supportAccessGrantOwnerScopeSchema = z.enum(["tenant", "partner"]);
export type SupportAccessGrantOwnerScope = z.infer<typeof supportAccessGrantOwnerScopeSchema>;

/** `support_access_grants.grantee_scope` CHECK. */
export const supportAccessGrantGranteeScopeSchema = z.enum(["partner", "platform"]);
export type SupportAccessGrantGranteeScope = z.infer<typeof supportAccessGrantGranteeScopeSchema>;

/** `support_access_grants.kind` CHECK. */
export const supportAccessGrantKindSchema = z.enum(["request", "grant", "break_glass"]);
export type SupportAccessGrantKind = z.infer<typeof supportAccessGrantKindSchema>;

/** `support_access_grants.status` CHECK. */
export const supportAccessGrantStatusSchema = z.enum(["pending", "approved", "denied", "revoked"]);
export type SupportAccessGrantStatus = z.infer<typeof supportAccessGrantStatusSchema>;

/**
 * `support_access_grants` row — 19 columns.
 *
 * `support_access_grants_exactly_one_owner`, `..._grantee_check`, and
 * `..._approved_has_window` (not modeled here — cross-column constraints):
 * exactly one of `tenant_id`/`partner_id` per `owner_scope`, `grantee_partner_id`
 * set iff `grantee_scope = 'partner'`, and `starts_at`/`expires_at` both set
 * once `status = 'approved'`. `reason` has a non-empty CHECK; `requested_hours`
 * is `CHECK (requested_hours BETWEEN 1 AND 168)`.
 */
export const supportAccessGrantRowSchema = z
  .object({
    id: uuid,
    owner_scope: supportAccessGrantOwnerScopeSchema,
    tenant_id: uuid.nullable(),
    partner_id: uuid.nullable(),
    grantee_scope: supportAccessGrantGranteeScopeSchema,
    grantee_partner_id: uuid.nullable(),
    ticket_id: uuid.nullable(),
    kind: supportAccessGrantKindSchema,
    status: supportAccessGrantStatusSchema,
    reason: z.string(),
    requested_hours: z.number().int().min(1).max(168),
    requested_by: uuid.nullable(),
    requested_at: timestamptz,
    decided_by: uuid.nullable(),
    decided_at: timestamptz.nullable(),
    decision_note: z.string().nullable(),
    starts_at: timestamptz.nullable(),
    expires_at: timestamptz.nullable(),
    revoked_by: uuid.nullable(),
    revoked_at: timestamptz.nullable(),
  })
  .strict();

export const supportAccessGrantInsertSchema = supportAccessGrantRowSchema
  .omit({ id: true, requested_at: true })
  .partial()
  .extend({
    owner_scope: supportAccessGrantOwnerScopeSchema,
    grantee_scope: supportAccessGrantGranteeScopeSchema,
    kind: supportAccessGrantKindSchema,
    reason: z.string(),
    requested_hours: z.number().int().min(1).max(168),
  })
  .strict();

export const supportAccessGrantUpdateSchema = supportAccessGrantRowSchema.partial();

export type SupportAccessGrantRow = z.infer<typeof supportAccessGrantRowSchema>;
export type SupportAccessGrantInsert = z.infer<typeof supportAccessGrantInsertSchema>;
export type SupportAccessGrantUpdate = z.infer<typeof supportAccessGrantUpdateSchema>;
