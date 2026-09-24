import { describe, expect, it } from "vitest";
import {
  supportTicketHistoryInsertSchema,
  supportTicketHistoryRowSchema,
  supportTicketHistoryUpdateSchema,
} from "../history";

const NOW = "2026-09-24T10:00:00.000+00:00";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";
const TICKET = "9a1b2c3d-0000-4000-8000-000000000001";
const USER = "9a1b2c3d-0000-4000-8000-000000000011";

/** Ground-truth fixture: support_ticket_history DDL (20251221000000). */
const historyFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000004",
  ticket_id: TICKET,
  tenant_id: TENANT,
  changed_by: USER,
  field_name: "status",
  old_value: "open",
  new_value: "resolved",
  created_at: NOW,
};

describe("support_ticket_history", () => {
  it("row round-trip (8 columns, no updated_at)", () => {
    expect(Object.keys(supportTicketHistoryRowSchema.shape).sort()).toEqual(
      [
        "id",
        "ticket_id",
        "tenant_id",
        "changed_by",
        "field_name",
        "old_value",
        "new_value",
        "created_at",
      ].sort(),
    );
    const parsed = supportTicketHistoryRowSchema.parse(historyFixture);
    expect(parsed).toEqual(historyFixture);
    expect(supportTicketHistoryRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(
      supportTicketHistoryRowSchema.safeParse({ ...historyFixture, extra: true }).success,
    ).toBe(false);
  });

  it("field_name is free-form TEXT (no CHECK constraint in the DDL)", () => {
    expect(
      supportTicketHistoryRowSchema.safeParse({ ...historyFixture, field_name: "anything" })
        .success,
    ).toBe(true);
  });

  it("old_value/new_value are nullable", () => {
    expect(
      supportTicketHistoryRowSchema.safeParse({
        ...historyFixture,
        old_value: null,
        new_value: null,
      }).success,
    ).toBe(true);
  });

  it("insert requires ticket_id, tenant_id, changed_by, field_name only", () => {
    const required = {
      ticket_id: TICKET,
      tenant_id: TENANT,
      changed_by: USER,
      field_name: "status",
    };
    expect(supportTicketHistoryInsertSchema.safeParse(required).success).toBe(true);
    for (const key of Object.keys(required)) {
      const payload = { ...required } as Record<string, unknown>;
      delete payload[key];
      expect(supportTicketHistoryInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(supportTicketHistoryUpdateSchema.safeParse({ new_value: "closed" }).success).toBe(true);
    expect(supportTicketHistoryUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
