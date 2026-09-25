import { describe, expect, it } from "vitest";
import {
  taskInsertSchema,
  taskPrioritySchema,
  taskRowSchema,
  taskStatusSchema,
  taskUpdateSchema,
} from "../tasks";

const NOW = "2026-09-24T10:00:00.000+00:00";

/** Ground-truth fixture: tasks effective DDL (15 columns, 20251208000000). */
const taskFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000040",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  contact_id: null,
  company_id: null,
  deal_id: "9a1b2c3d-0000-4000-8000-000000000021",
  title: "Follow up on renewal",
  description: "Ground-truth fixture",
  status: "todo",
  priority: "high",
  due_date: NOW,
  reminder_date: NOW,
  completed_at: null,
  created_by: "9a1b2c3d-0000-4000-8000-000000000012",
  assigned_to: "9a1b2c3d-0000-4000-8000-000000000013",
  created_at: NOW,
  updated_at: NOW,
};

describe("tasks", () => {
  it("tasks row round-trip (15 columns)", () => {
    expect(Object.keys(taskRowSchema.shape).sort()).toEqual(
      [
        "assigned_to",
        "company_id",
        "completed_at",
        "contact_id",
        "created_at",
        "created_by",
        "deal_id",
        "description",
        "due_date",
        "id",
        "priority",
        "reminder_date",
        "status",
        "tenant_id",
        "title",
        "updated_at",
      ].sort(),
    );
    const parsed = taskRowSchema.parse(taskFixture);
    expect(parsed).toEqual(taskFixture);
  });

  it("status is NOT NULL; priority is nullable", () => {
    expect(taskRowSchema.safeParse({ ...taskFixture, status: null }).success).toBe(false);
    expect(taskRowSchema.safeParse({ ...taskFixture, priority: null }).success).toBe(true);
  });

  it("status/priority enums reject invalid values", () => {
    expect(taskStatusSchema.safeParse("todo").success).toBe(true);
    expect(taskStatusSchema.safeParse("archived").success).toBe(false);
    expect(taskPrioritySchema.safeParse("urgent").success).toBe(true);
    expect(taskPrioritySchema.safeParse("critical").success).toBe(false);
  });

  it("insert requires tenant_id/title", () => {
    expect(
      taskInsertSchema.safeParse({
        tenant_id: taskFixture.tenant_id,
        title: "Follow up",
        deal_id: taskFixture.deal_id,
      }).success,
    ).toBe(true);
    expect(taskInsertSchema.safeParse({ title: "Follow up" }).success).toBe(false);
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(taskUpdateSchema.safeParse({ status: "done" }).success).toBe(true);
    expect(taskUpdateSchema.safeParse({ archived: true }).success).toBe(false);
  });
});
