import { describe, expect, it } from "vitest";
import {
  supportAccessGrantInsertSchema,
  supportAccessGrantOwnerScopeSchema,
  supportAccessGrantRowSchema,
  supportAccessGrantUpdateSchema,
} from "../support-access-grants";

const NOW = "2026-09-24T10:00:00.000+00:00";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";
const USER = "9a1b2c3d-0000-4000-8000-000000000011";

/** Ground-truth fixture: support_access_grants DDL (20260924120000). */
const grantFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000040",
  owner_scope: "tenant",
  tenant_id: TENANT,
  partner_id: null,
  grantee_scope: "platform",
  grantee_partner_id: null,
  ticket_id: null,
  kind: "request",
  status: "pending",
  reason: "Customer requested platform escalation",
  requested_hours: 24,
  requested_by: USER,
  requested_at: NOW,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  starts_at: null,
  expires_at: null,
  revoked_by: null,
  revoked_at: null,
};

describe("support_access_grants", () => {
  it("row round-trip (19 columns)", () => {
    expect(Object.keys(supportAccessGrantRowSchema.shape).sort()).toEqual(
      [
        "id",
        "owner_scope",
        "tenant_id",
        "partner_id",
        "grantee_scope",
        "grantee_partner_id",
        "ticket_id",
        "kind",
        "status",
        "reason",
        "requested_hours",
        "requested_by",
        "requested_at",
        "decided_by",
        "decided_at",
        "decision_note",
        "starts_at",
        "expires_at",
        "revoked_by",
        "revoked_at",
      ].sort(),
    );
    const parsed = supportAccessGrantRowSchema.parse(grantFixture);
    expect(parsed).toEqual(grantFixture);
    expect(supportAccessGrantRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(supportAccessGrantRowSchema.safeParse({ ...grantFixture, extra: true }).success).toBe(false);
  });

  it("owner_scope is narrower than the other support tables — never platform", () => {
    expect(supportAccessGrantOwnerScopeSchema.safeParse("tenant").success).toBe(true);
    expect(supportAccessGrantOwnerScopeSchema.safeParse("partner").success).toBe(true);
    expect(supportAccessGrantOwnerScopeSchema.safeParse("platform").success).toBe(false);
    expect(
      supportAccessGrantRowSchema.safeParse({ ...grantFixture, owner_scope: "platform" }).success,
    ).toBe(false);
  });

  it("grantee_scope rejects a value outside partner/platform", () => {
    expect(
      supportAccessGrantRowSchema.safeParse({ ...grantFixture, grantee_scope: "tenant" }).success,
    ).toBe(false);
  });

  it("kind rejects a value outside request/grant/break_glass", () => {
    expect(supportAccessGrantRowSchema.safeParse({ ...grantFixture, kind: "bogus" }).success).toBe(
      false,
    );
  });

  it("status rejects a value outside pending/approved/denied/revoked", () => {
    expect(supportAccessGrantRowSchema.safeParse({ ...grantFixture, status: "bogus" }).success).toBe(
      false,
    );
  });

  it("requested_hours must be an integer between 1 and 168", () => {
    expect(supportAccessGrantRowSchema.safeParse({ ...grantFixture, requested_hours: 0 }).success).toBe(
      false,
    );
    expect(
      supportAccessGrantRowSchema.safeParse({ ...grantFixture, requested_hours: 169 }).success,
    ).toBe(false);
    expect(
      supportAccessGrantRowSchema.safeParse({ ...grantFixture, requested_hours: 1.5 }).success,
    ).toBe(false);
    expect(supportAccessGrantRowSchema.safeParse({ ...grantFixture, requested_hours: 168 }).success).toBe(
      true,
    );
  });

  it("insert requires owner_scope, grantee_scope, kind, reason, requested_hours only", () => {
    const required = {
      owner_scope: "tenant",
      grantee_scope: "platform",
      kind: "request",
      reason: "Customer requested platform escalation",
      requested_hours: 24,
    };
    expect(supportAccessGrantInsertSchema.safeParse(required).success).toBe(true);
    for (const key of Object.keys(required)) {
      const payload = { ...required } as Record<string, unknown>;
      delete payload[key];
      expect(supportAccessGrantInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(supportAccessGrantUpdateSchema.safeParse({ status: "approved" }).success).toBe(true);
    expect(supportAccessGrantUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
