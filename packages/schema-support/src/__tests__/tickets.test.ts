import { describe, expect, it } from "vitest";
import {
  supportTicketInsertSchema,
  supportTicketPrioritySchema,
  supportTicketRowSchema,
  supportTicketStatusSchema,
  supportTicketUpdateSchema,
} from "../tickets";

const NOW = "2026-09-24T10:00:00.000+00:00";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";
const USER = "9a1b2c3d-0000-4000-8000-000000000011";

/** Ground-truth fixture: support_tickets composite DDL (3 migrations). */
const ticketFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000001",
  tenant_id: TENANT,
  ticket_number: "TKT-2026-00001",
  subject: "Cannot log in",
  description: "Password reset link expired",
  status: "open",
  priority: "high",
  category_id: null,
  created_by: USER,
  assigned_to: null,
  created_at: NOW,
  updated_at: NOW,
  support_code: "KX-NUM-004",
  support_ref: "ref_abc123",
  escalated_to_platform_admin_at: null,
  external_refs: {},
  sync_state: { status: "clean" },
};

describe("support_tickets", () => {
  it("row round-trip (17 columns)", () => {
    expect(Object.keys(supportTicketRowSchema.shape).sort()).toEqual(
      [
        "id",
        "tenant_id",
        "ticket_number",
        "subject",
        "description",
        "status",
        "priority",
        "category_id",
        "created_by",
        "assigned_to",
        "created_at",
        "updated_at",
        "support_code",
        "support_ref",
        "escalated_to_platform_admin_at",
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

  it("status/priority enums reject invalid values", () => {
    expect(supportTicketStatusSchema.safeParse("open").success).toBe(true);
    expect(supportTicketStatusSchema.safeParse("archived").success).toBe(false);
    expect(supportTicketPrioritySchema.safeParse("urgent").success).toBe(true);
    expect(supportTicketPrioritySchema.safeParse("critical").success).toBe(false);
    expect(supportTicketRowSchema.safeParse({ ...ticketFixture, status: "archived" }).success).toBe(
      false,
    );
  });

  it("external_refs/sync_state are NOT NULL (20260905000000 — SQL wins over core-kernel's types, which omit both)", () => {
    expect(supportTicketRowSchema.safeParse({ ...ticketFixture, external_refs: null }).success).toBe(
      false,
    );
    expect(supportTicketRowSchema.safeParse({ ...ticketFixture, sync_state: null }).success).toBe(
      false,
    );
  });

  it("insert requires tenant_id, subject, created_by only — ticket_number is trigger-generated", () => {
    expect(
      supportTicketInsertSchema.safeParse({
        tenant_id: TENANT,
        subject: "Cannot log in",
        created_by: USER,
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "subject", "created_by"]) {
      const payload: Record<string, unknown> = {
        tenant_id: TENANT,
        subject: "Cannot log in",
        created_by: USER,
      };
      delete payload[required];
      expect(supportTicketInsertSchema.safeParse(payload).success).toBe(false);
    }
    // ticket_number must not be settable through insert (owned by the DB trigger).
    expect(
      supportTicketInsertSchema.safeParse({
        tenant_id: TENANT,
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
