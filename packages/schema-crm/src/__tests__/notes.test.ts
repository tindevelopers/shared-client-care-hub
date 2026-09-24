import { describe, expect, it } from "vitest";
import { noteInsertSchema, noteRowSchema, noteTypeSchema, noteUpdateSchema } from "../notes";

const NOW = "2026-09-24T10:00:00.000+00:00";

/** Ground-truth fixture: notes effective DDL (12 columns, 20251208000000). */
const noteFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000050",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  contact_id: null,
  company_id: "9a1b2c3d-0000-4000-8000-000000000001",
  deal_id: null,
  title: "Call recap",
  content: "Ground-truth fixture",
  type: "call",
  metadata: { durationMinutes: 15 },
  created_by: "9a1b2c3d-0000-4000-8000-000000000012",
  created_at: NOW,
  updated_at: NOW,
};

describe("notes", () => {
  it("notes row round-trip (12 columns)", () => {
    expect(Object.keys(noteRowSchema.shape).sort()).toEqual(
      [
        "company_id",
        "contact_id",
        "content",
        "created_at",
        "created_by",
        "deal_id",
        "id",
        "metadata",
        "tenant_id",
        "title",
        "type",
        "updated_at",
      ].sort(),
    );
    const parsed = noteRowSchema.parse(noteFixture);
    expect(parsed).toEqual(noteFixture);
  });

  it("content is NOT NULL; type is nullable", () => {
    expect(noteRowSchema.safeParse({ ...noteFixture, content: undefined }).success).toBe(false);
    expect(noteRowSchema.safeParse({ ...noteFixture, type: null }).success).toBe(true);
  });

  it("type enum accepts the five CHECK values and rejects others", () => {
    for (const value of ["note", "email", "call", "meeting", "other"]) {
      expect(noteTypeSchema.safeParse(value).success).toBe(true);
    }
    expect(noteTypeSchema.safeParse("sms").success).toBe(false);
  });

  it("insert requires tenant_id/content", () => {
    expect(
      noteInsertSchema.safeParse({
        tenant_id: noteFixture.tenant_id,
        content: "Note body",
        company_id: noteFixture.company_id,
      }).success,
    ).toBe(true);
    expect(noteInsertSchema.safeParse({ content: "Note body" }).success).toBe(false);
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(noteUpdateSchema.safeParse({ content: "Updated" }).success).toBe(true);
    expect(noteUpdateSchema.safeParse({ pinned: true }).success).toBe(false);
  });
});
