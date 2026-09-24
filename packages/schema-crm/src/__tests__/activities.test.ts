import { describe, expect, it } from "vitest";
import {
  activityInsertSchema,
  activityRowSchema,
  activityTypeSchema,
  activityUpdateSchema,
} from "../activities";

const NOW = "2026-09-24T10:00:00.000+00:00";

/** Ground-truth fixture: activities effective DDL (12 columns, 20251208000000). */
const activityFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000060",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  contact_id: null,
  company_id: null,
  deal_id: "9a1b2c3d-0000-4000-8000-000000000021",
  task_id: null,
  note_id: null,
  type: "deal_stage_changed",
  description: "Ground-truth fixture",
  metadata: { from: "Lead", to: "Qualified" },
  created_by: "9a1b2c3d-0000-4000-8000-000000000012",
  created_at: NOW,
};

const ORIGINAL_10 = [
  "created",
  "updated",
  "deleted",
  "note_added",
  "task_created",
  "task_completed",
  "deal_stage_changed",
  "email_sent",
  "call_made",
  "meeting_scheduled",
];

const WEBHOOK_6 = [
  "email_opened",
  "email_clicked",
  "email_bounced",
  "email_delivered",
  "email_failed",
  "email_unsubscribed",
];

describe("activities", () => {
  it("activities row round-trip (12 columns)", () => {
    expect(Object.keys(activityRowSchema.shape).sort()).toEqual(
      [
        "company_id",
        "contact_id",
        "created_at",
        "created_by",
        "deal_id",
        "description",
        "id",
        "metadata",
        "note_id",
        "task_id",
        "tenant_id",
        "type",
      ].sort(),
    );
    const parsed = activityRowSchema.parse(activityFixture);
    expect(parsed).toEqual(activityFixture);
  });

  it("type CHECK covers the extended 16-value set (20260614230000)", () => {
    for (const value of [...ORIGINAL_10, ...WEBHOOK_6]) {
      expect(activityTypeSchema.safeParse(value).success).toBe(true);
    }
    expect(activityTypeSchema.safeParse("email_opened_twice").success).toBe(false);
  });

  it("type is NOT NULL", () => {
    expect(activityRowSchema.safeParse({ ...activityFixture, type: null }).success).toBe(false);
  });

  it("insert requires tenant_id/type/description", () => {
    expect(
      activityInsertSchema.safeParse({
        tenant_id: activityFixture.tenant_id,
        type: "created",
        description: "Deal created",
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "type", "description"]) {
      const payload: Record<string, unknown> = {
        tenant_id: activityFixture.tenant_id,
        type: "created",
        description: "Deal created",
      };
      delete payload[required];
      expect(activityInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(activityUpdateSchema.safeParse({ description: "Edited" }).success).toBe(true);
    expect(activityUpdateSchema.safeParse({ archived: true }).success).toBe(false);
  });
});
