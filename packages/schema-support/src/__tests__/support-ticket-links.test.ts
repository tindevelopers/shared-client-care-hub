import { describe, expect, it } from "vitest";
import {
  supportTicketLinkInsertSchema,
  supportTicketLinkRowSchema,
  supportTicketLinkUpdateSchema,
} from "../support-ticket-links";

const NOW = "2026-09-24T10:00:00.000+00:00";
const FROM_TICKET = "9a1b2c3d-0000-4000-8000-000000000001";
const TO_TICKET = "9a1b2c3d-0000-4000-8000-000000000002";
const USER = "9a1b2c3d-0000-4000-8000-000000000011";

/** Ground-truth fixture: support_ticket_links DDL (20260924100000). */
const linkFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000030",
  kind: "escalation",
  from_ticket_id: FROM_TICKET,
  to_ticket_id: TO_TICKET,
  provider: null,
  external_id: null,
  state: "active",
  shared: {},
  resolution: null,
  created_by: USER,
  created_at: NOW,
  closed_at: null,
};

describe("support_ticket_links", () => {
  it("row round-trip (12 columns)", () => {
    expect(Object.keys(supportTicketLinkRowSchema.shape).sort()).toEqual(
      [
        "id",
        "kind",
        "from_ticket_id",
        "to_ticket_id",
        "provider",
        "external_id",
        "state",
        "shared",
        "resolution",
        "created_by",
        "created_at",
        "closed_at",
      ].sort(),
    );
    const parsed = supportTicketLinkRowSchema.parse(linkFixture);
    expect(parsed).toEqual(linkFixture);
    expect(supportTicketLinkRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(supportTicketLinkRowSchema.safeParse({ ...linkFixture, extra: true }).success).toBe(false);
  });

  it("kind rejects a value outside escalation/merge", () => {
    expect(supportTicketLinkRowSchema.safeParse({ ...linkFixture, kind: "bogus" }).success).toBe(false);
  });

  it("state rejects a value outside active/resolved/returned/withdrawn", () => {
    expect(supportTicketLinkRowSchema.safeParse({ ...linkFixture, state: "bogus" }).success).toBe(false);
  });

  it("to_ticket_id/provider/external_id/resolution/closed_at are nullable", () => {
    expect(
      supportTicketLinkRowSchema.safeParse({
        ...linkFixture,
        to_ticket_id: null,
        provider: "zendesk",
        external_id: "ext-1",
      }).success,
    ).toBe(true);
  });

  it("insert requires kind, from_ticket_id, created_by only", () => {
    const required = { kind: "escalation", from_ticket_id: FROM_TICKET, created_by: USER };
    expect(supportTicketLinkInsertSchema.safeParse(required).success).toBe(true);
    for (const key of Object.keys(required)) {
      const payload = { ...required } as Record<string, unknown>;
      delete payload[key];
      expect(supportTicketLinkInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(supportTicketLinkUpdateSchema.safeParse({ state: "resolved" }).success).toBe(true);
    expect(supportTicketLinkUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
