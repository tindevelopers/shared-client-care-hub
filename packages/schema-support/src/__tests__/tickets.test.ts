import { describe, expect, it } from "vitest";
import {
  supportOwnerScopeSchema,
  supportTicketInsertSchema,
  supportTicketPrioritySchema,
  supportTicketRowSchema,
  supportTicketStatusSchema,
  supportTicketUpdateSchema,
} from "../tickets";

const NOW = "2026-09-24T10:00:00.000+00:00";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";
const USER = "9a1b2c3d-0000-4000-8000-000000000011";

/** Ground-truth fixture: support_tickets composite DDL (4 migrations). */
const ticketFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000001",
  tenant_id: TENANT,
  partner_id: null,
  owner_scope: "tenant",
  ticket_number: "TKT-2026-00001",
  subject: "Cannot log in",
  description: "Password reset link expired",
  status: "open",
  priority: "high",
  category_id: null,
  group_id: null,
  created_by: USER,
  assigned_to: null,
  created_at: NOW,
  updated_at: NOW,
  support_code: "KX-NUM-004",
  support_ref: "ref_abc123",
  external_refs: {},
  sync_state: { status: "clean" },
};

describe("support_tickets", () => {
  it("row round-trip (19 columns)", () => {
    expect(Object.keys(supportTicketRowSchema.shape).sort()).toEqual(
      [
        "id",
        "tenant_id",
        "partner_id",
        "owner_scope",
        "ticket_number",
        "subject",
        "description",
        "status",
        "priority",
        "category_id",
        "group_id",
        "created_by",
        "assigned_to",
        "created_at",
        "updated_at",
        "support_code",
        "support_ref",
        "external_refs",
        "sync_state",
      ].sort(),
    );
    const parsed = supportTicketRowSchema.parse(ticketFixture);
    expect(parsed).toEqual(ticketFixture);
    expect(supportTicketRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(supportTicketRowSchema.safeParse({ ...ticketFixture, extra: true }).success).toBe(false);
  });

  it("escalated_to_platform_admin_at is gone (dropped by 20260924100000)", () => {
    expect(
      supportTicketRowSchema.safeParse({ ...ticketFixture, escalated_to_platform_admin_at: null }).success,
    ).toBe(false);
  });

  it("status/priority enums reject invalid values", () => {
    expect(supportTicketStatusSchema.safeParse("open").success).toBe(true);
    expect(supportTicketStatusSchema.safeParse("archived").success).toBe(false);
    expect(supportTicketPrioritySchema.safeParse("urgent").success).toBe(true);
    expect(supportTicketPrioritySchema.safeParse("critical").success).toBe(false);
    expect(supportTicketRowSchema.safeParse({ ...ticketFixture, status: "archived" }).success).toBe(
      false,
    );
  });

  it("status enum accepts the escalation-chain waiting states added by 20260924100000", () => {
    expect(supportTicketStatusSchema.safeParse("waiting_on_customer").success).toBe(true);
    expect(supportTicketStatusSchema.safeParse("waiting_on_upstream").success).toBe(true);
  });

  it("owner_scope enum accepts tenant/partner/platform and rejects anything else", () => {
    expect(supportOwnerScopeSchema.safeParse("tenant").success).toBe(true);
    expect(supportOwnerScopeSchema.safeParse("partner").success).toBe(true);
    expect(supportOwnerScopeSchema.safeParse("platform").success).toBe(true);
    expect(supportOwnerScopeSchema.safeParse("bogus").success).toBe(false);
    expect(supportTicketRowSchema.safeParse({ ...ticketFixture, owner_scope: "bogus" }).success).toBe(
      false,
    );
  });

  it("tenant_id/partner_id/group_id are nullable (20260924100000 — a partner- or platform-owned ticket has no tenant)", () => {
    expect(
      supportTicketRowSchema.safeParse({
        ...ticketFixture,
        tenant_id: null,
        partner_id: "9a1b2c3d-0000-4000-8000-000000000099",
        owner_scope: "partner",
      }).success,
    ).toBe(true);
    expect(supportTicketRowSchema.safeParse({ ...ticketFixture, group_id: null }).success).toBe(true);
  });

  it("external_refs/sync_state are NOT NULL (20260905000000 — SQL wins over core-kernel's types, which omit both)", () => {
    expect(supportTicketRowSchema.safeParse({ ...ticketFixture, external_refs: null }).success).toBe(
      false,
    );
    expect(supportTicketRowSchema.safeParse({ ...ticketFixture, sync_state: null }).success).toBe(
      false,
    );
  });

  it("row schema accepts external_refs/sync_state being absent (migration not shipped by this package)", () => {
    const { external_refs: _external_refs, sync_state: _sync_state, ...withoutSyncColumns } = ticketFixture;
    expect(supportTicketRowSchema.safeParse(withoutSyncColumns).success).toBe(true);
  });

  it("insert schema omits external_refs/sync_state (their migration is not shipped by this package)", () => {
    expect(
      supportTicketInsertSchema.safeParse({
        subject: "Cannot log in",
        created_by: USER,
        external_refs: {},
      }).success,
    ).toBe(false);
    expect(
      supportTicketInsertSchema.safeParse({
        subject: "Cannot log in",
        created_by: USER,
        sync_state: {},
      }).success,
    ).toBe(false);
  });

  it("insert requires subject and created_by only — tenant_id is nullable, owner_scope/ticket_number are DB-owned", () => {
    expect(
      supportTicketInsertSchema.safeParse({
        subject: "Cannot log in",
        created_by: USER,
      }).success,
    ).toBe(true);
    for (const required of ["subject", "created_by"]) {
      const payload: Record<string, unknown> = {
        subject: "Cannot log in",
        created_by: USER,
      };
      delete payload[required];
      expect(supportTicketInsertSchema.safeParse(payload).success).toBe(false);
    }
    // ticket_number must not be settable through insert (owned by the DB trigger).
    expect(
      supportTicketInsertSchema.safeParse({
        subject: "Cannot log in",
        created_by: USER,
        ticket_number: "TKT-2026-00001",
      }).success,
    ).toBe(false);
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(supportTicketUpdateSchema.safeParse({ status: "resolved" }).success).toBe(true);
    expect(supportTicketUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
