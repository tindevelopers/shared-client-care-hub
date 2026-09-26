import { describe, expect, it } from "vitest";
import {
  supportTicketThreadInsertSchema,
  supportTicketThreadRowSchema,
  supportTicketThreadUpdateSchema,
} from "../threads";

const NOW = "2026-09-24T10:00:00.000+00:00";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";
const TICKET = "9a1b2c3d-0000-4000-8000-000000000001";
const USER = "9a1b2c3d-0000-4000-8000-000000000011";

/** Ground-truth fixture: support_ticket_threads composite DDL (2 migrations). */
const threadFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000002",
  ticket_id: TICKET,
  tenant_id: TENANT,
  partner_id: null,
  owner_scope: "tenant",
  user_id: USER,
  message: "We're looking into this now.",
  is_internal: false,
  created_at: NOW,
  updated_at: NOW,
};

describe("support_ticket_threads", () => {
  it("row round-trip (10 columns)", () => {
    expect(Object.keys(supportTicketThreadRowSchema.shape).sort()).toEqual(
      [
        "id",
        "ticket_id",
        "tenant_id",
        "partner_id",
        "owner_scope",
        "user_id",
        "message",
        "is_internal",
        "created_at",
        "updated_at",
      ].sort(),
    );
    const parsed = supportTicketThreadRowSchema.parse(threadFixture);
    expect(parsed).toEqual(threadFixture);
    expect(supportTicketThreadRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(
      supportTicketThreadRowSchema.safeParse({ ...threadFixture, extra: true }).success,
    ).toBe(false);
  });

  it("owner_scope rejects a value outside tenant/partner/platform", () => {
    expect(
      supportTicketThreadRowSchema.safeParse({ ...threadFixture, owner_scope: "bogus" }).success,
    ).toBe(false);
  });

  it("tenant_id is nullable (20260924100000 — overwritten by the owner-inherit trigger anyway)", () => {
    expect(
      supportTicketThreadRowSchema.safeParse({ ...threadFixture, tenant_id: null, owner_scope: "platform" })
        .success,
    ).toBe(true);
  });

  it("is_internal is nullable (DDL has no NOT NULL, unlike core-kernel's typed boolean)", () => {
    expect(
      supportTicketThreadRowSchema.safeParse({ ...threadFixture, is_internal: null }).success,
    ).toBe(true);
  });

  it("insert requires ticket_id, user_id, message only — tenant_id/owner_scope are trigger-owned", () => {
    expect(
      supportTicketThreadInsertSchema.safeParse({
        ticket_id: TICKET,
        user_id: USER,
        message: "hi",
      }).success,
    ).toBe(true);
    for (const required of ["ticket_id", "user_id", "message"]) {
      const payload: Record<string, unknown> = {
        ticket_id: TICKET,
        user_id: USER,
        message: "hi",
      };
      delete payload[required];
      expect(supportTicketThreadInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(supportTicketThreadUpdateSchema.safeParse({ is_internal: true }).success).toBe(true);
    expect(supportTicketThreadUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
