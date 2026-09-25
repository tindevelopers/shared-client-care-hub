import { describe, expect, it } from "vitest";
import {
  supportAccessEventInsertSchema,
  supportAccessEventRowSchema,
  supportAccessEventUpdateSchema,
} from "../support-access-events";

const NOW = "2026-09-24T10:00:00.000+00:00";
const GRANT = "9a1b2c3d-0000-4000-8000-000000000040";
const USER = "9a1b2c3d-0000-4000-8000-000000000011";
const TICKET = "9a1b2c3d-0000-4000-8000-000000000001";

/** Ground-truth fixture: support_access_events DDL (20260924120000). */
const eventFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000050",
  grant_id: GRANT,
  actor_id: USER,
  action: "view_ticket",
  ticket_id: TICKET,
  attachment_id: null,
  created_at: NOW,
};

describe("support_access_events", () => {
  it("row round-trip (6 columns, no updated_at)", () => {
    expect(Object.keys(supportAccessEventRowSchema.shape).sort()).toEqual(
      ["id", "grant_id", "actor_id", "action", "ticket_id", "attachment_id", "created_at"].sort(),
    );
    const parsed = supportAccessEventRowSchema.parse(eventFixture);
    expect(parsed).toEqual(eventFixture);
    expect(supportAccessEventRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(supportAccessEventRowSchema.safeParse({ ...eventFixture, extra: true }).success).toBe(false);
  });

  it("action rejects a value outside list_tickets/view_ticket/download_attachment", () => {
    expect(supportAccessEventRowSchema.safeParse({ ...eventFixture, action: "bogus" }).success).toBe(
      false,
    );
  });

  it("actor_id/ticket_id/attachment_id are nullable", () => {
    expect(
      supportAccessEventRowSchema.safeParse({
        ...eventFixture,
        actor_id: null,
        ticket_id: null,
        attachment_id: "9a1b2c3d-0000-4000-8000-000000000060",
      }).success,
    ).toBe(true);
  });

  it("insert requires grant_id and action only", () => {
    const required = { grant_id: GRANT, action: "view_ticket" };
    expect(supportAccessEventInsertSchema.safeParse(required).success).toBe(true);
    for (const key of Object.keys(required)) {
      const payload = { ...required } as Record<string, unknown>;
      delete payload[key];
      expect(supportAccessEventInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(supportAccessEventUpdateSchema.safeParse({ action: "list_tickets" }).success).toBe(true);
    expect(supportAccessEventUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
