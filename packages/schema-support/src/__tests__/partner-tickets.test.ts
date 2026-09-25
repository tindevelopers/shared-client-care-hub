import { describe, expect, it } from "vitest";
import {
  partnerSupportTicketInsertSchema,
  partnerSupportTicketPrioritySchema,
  partnerSupportTicketReplyInsertSchema,
  partnerSupportTicketReplyRowSchema,
  partnerSupportTicketReplyUpdateSchema,
  partnerSupportTicketRowSchema,
  partnerSupportTicketStatusSchema,
  partnerSupportTicketUpdateSchema,
} from "../partner-tickets";

const NOW = "2026-09-24T10:00:00.000+00:00";
const PARTNER = "9a1b2c3d-0000-4000-8000-000000000020";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";
const USER = "9a1b2c3d-0000-4000-8000-000000000011";
const TICKET = "9a1b2c3d-0000-4000-8000-000000000021";

/** Ground-truth fixture: partner_support_tickets DDL (20260913130000). */
const ticketFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000022",
  partner_id: PARTNER,
  tenant_id: TENANT,
  subject: "Client billing dispute",
  details: "Client says they were double-charged.",
  priority: "high",
  status: "open",
  created_by: USER,
  created_at: NOW,
  updated_at: NOW,
};

describe("partner_support_tickets", () => {
  it("row round-trip (10 columns)", () => {
    expect(Object.keys(partnerSupportTicketRowSchema.shape).sort()).toEqual(
      [
        "id",
        "partner_id",
        "tenant_id",
        "subject",
        "details",
        "priority",
        "status",
        "created_by",
        "created_at",
        "updated_at",
      ].sort(),
    );
    const parsed = partnerSupportTicketRowSchema.parse(ticketFixture);
    expect(parsed).toEqual(ticketFixture);
    expect(partnerSupportTicketRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(partnerSupportTicketRowSchema.safeParse({ ...ticketFixture, extra: true }).success).toBe(
      false,
    );
  });

  it("tenant_id is nullable (a partner ticket need not concern one tenant)", () => {
    expect(
      partnerSupportTicketRowSchema.safeParse({ ...ticketFixture, tenant_id: null }).success,
    ).toBe(true);
  });

  it("priority/status enums reject invalid values (no 'urgent'/'closed' — different CHECK than support_tickets)", () => {
    expect(partnerSupportTicketPrioritySchema.safeParse("high").success).toBe(true);
    expect(partnerSupportTicketPrioritySchema.safeParse("urgent").success).toBe(false);
    expect(partnerSupportTicketStatusSchema.safeParse("resolved").success).toBe(true);
    expect(partnerSupportTicketStatusSchema.safeParse("closed").success).toBe(false);
  });

  it("insert requires partner_id, subject, created_by only", () => {
    expect(
      partnerSupportTicketInsertSchema.safeParse({
        partner_id: PARTNER,
        subject: "Client billing dispute",
        created_by: USER,
      }).success,
    ).toBe(true);
    for (const required of ["partner_id", "subject", "created_by"]) {
      const payload: Record<string, unknown> = {
        partner_id: PARTNER,
        subject: "Client billing dispute",
        created_by: USER,
      };
      delete payload[required];
      expect(partnerSupportTicketInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(partnerSupportTicketUpdateSchema.safeParse({ status: "resolved" }).success).toBe(true);
    expect(partnerSupportTicketUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});

/** Ground-truth fixture: partner_support_ticket_replies DDL (20260913130000). */
const replyFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000023",
  ticket_id: TICKET,
  author_user_id: USER,
  body: "We're looking into this now.",
  created_at: NOW,
};

describe("partner_support_ticket_replies", () => {
  it("row round-trip (5 columns, no updated_at — append-only)", () => {
    expect(Object.keys(partnerSupportTicketReplyRowSchema.shape).sort()).toEqual(
      ["id", "ticket_id", "author_user_id", "body", "created_at"].sort(),
    );
    const parsed = partnerSupportTicketReplyRowSchema.parse(replyFixture);
    expect(parsed).toEqual(replyFixture);
    expect(partnerSupportTicketReplyRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(
      partnerSupportTicketReplyRowSchema.safeParse({ ...replyFixture, extra: true }).success,
    ).toBe(false);
  });

  it("insert requires ticket_id, author_user_id, body only", () => {
    const required = { ticket_id: TICKET, author_user_id: USER, body: "hi" };
    expect(partnerSupportTicketReplyInsertSchema.safeParse(required).success).toBe(true);
    for (const key of Object.keys(required)) {
      const payload = { ...required } as Record<string, unknown>;
      delete payload[key];
      expect(partnerSupportTicketReplyInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(partnerSupportTicketReplyUpdateSchema.safeParse({ body: "edited" }).success).toBe(true);
    expect(partnerSupportTicketReplyUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
