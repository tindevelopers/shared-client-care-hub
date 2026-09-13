/**
 * Segment materializer unit tests (VAL-CONTACTS-013/014/021 unit half).
 *
 * Drift fix #1 (ground truth: hosted DB returns Postgres 42703 for both):
 * - the contacts SELECT carries no `lifecycle_stage` / `score` columns;
 * - a `lifecycleStage` segment filter throws LifecycleStageUnsupportedError
 *   BEFORE any DB call;
 * - `contactGroupId` resolves through `contact_group_members`, never a
 *   (nonexistent) `contacts.contact_group_id` column;
 * - opt-out filtering (`email_opt_out` / `email_valid`) is preserved;
 * - the zero-eligible early return keeps the exact non-throwing shape
 *   `{ segmentCount, optedOutCount, materializedCount: 0, listId: 0,
 *   emails: [] }` consumed by campaign-service's warn-and-continue path.
 *
 * Hosted-Supabase behavior (no 42703 on the real SELECT, group resolution
 * against real membership rows) is covered by
 * segment-materializer.hosted.test.ts.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createMockSupabase } from "../../__tests__/helpers/mock-supabase.js";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@tindevelopers/core-kernel/logger", () => ({
  createLogger: () => loggerMock,
}));

import {
  materializeSegment,
  type SegmentDefinition,
} from "../segment-materializer.js";
import { LifecycleStageUnsupportedError } from "../../errors.js";

function eligibleRow(id: string, email: string) {
  return { id, email, email_opt_out: false, email_valid: true };
}

beforeEach(() => {
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
});

describe("segment materializer", () => {
  test("SELECT drops lifecycle_stage/score and selects the opt-out columns", async () => {
    const { client, calls } = createMockSupabase({ data: [] });
    await materializeSegment("tenant_1", {}, "list", { client });

    const select = calls.find((c) => c.op === "select");
    expect(select).toBeDefined();
    const columns = String(select!.args[0]);
    expect(columns).not.toContain("lifecycle_stage");
    expect(columns).not.toContain("score");
    expect(columns).toContain("email_opt_out");
    expect(columns).toContain("email_valid");
  });

  test("lifecycleStage filter throws LifecycleStageUnsupportedError before any DB call", async () => {
    const { client, calls } = createMockSupabase({ data: [] });
    const segment: SegmentDefinition = { lifecycleStage: "lead" };

    await expect(
      materializeSegment("tenant_1", segment, "list", { client }),
    ).rejects.toBeInstanceOf(LifecycleStageUnsupportedError);

    // The rejection is synchronous-in-spirit: no query builder call at all.
    await expect(
      materializeSegment("tenant_1", segment, "list", { client }),
    ).rejects.toThrow(/lifecycleStage/);
    expect(calls).toHaveLength(0);
  });

  test("filters email_opt_out/email_valid contacts (opt-out filtering preserved)", async () => {
    const rows = [
      eligibleRow("c1", "sendable@example.com"),
      { ...eligibleRow("c2", "opted-out@example.com"), email_opt_out: true },
      { ...eligibleRow("c3", "invalid@example.com"), email_valid: false },
    ];
    const { client } = createMockSupabase({ data: rows });

    const result = await materializeSegment("tenant_1", {}, "list", { client });

    expect(result.segmentCount).toBe(3);
    expect(result.optedOutCount).toBe(2);
    expect(result.materializedCount).toBe(1);
    expect(result.emails).toEqual(["sendable@example.com"]);
  });

  test("zero eligible early return keeps the exact non-throwing shape with a warn log", async () => {
    const rows = [
      { ...eligibleRow("c1", "one@example.com"), email_opt_out: true },
      { ...eligibleRow("c2", "two@example.com"), email_valid: false },
    ];
    const { client } = createMockSupabase({ data: rows });

    const result = await materializeSegment("tenant_1", {}, "list", { client });

    expect(result).toEqual({
      segmentCount: 2,
      optedOutCount: 2,
      materializedCount: 0,
      listId: 0,
      emails: [],
    });
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn.mock.calls[0][0]).toContain(
      "No eligible contacts in segment after opt-out filtering",
    );
  });

  test("contactGroupId resolves through contact_group_members, not a contacts column", async () => {
    // Queue order = await order: membership query first, contacts query second.
    const { client, calls } = createMockSupabase([
      {
        data: [{ contact_id: "c1" }, { contact_id: "c2" }, { contact_id: "c1" }],
      },
      { data: [eligibleRow("c1", "a@example.com"), eligibleRow("c2", "b@example.com")] },
    ]);

    const result = await materializeSegment(
      "tenant_1",
      { contactGroupId: "group_1" },
      "list",
      { client },
    );

    // Membership read: contact_group_members with tenant + group scoping.
    const froms = calls.filter((c) => c.op === "from").map((c) => c.args[0]);
    expect(froms).toContain("contact_group_members");
    const eqs = calls.filter((c) => c.op === "eq");
    expect(eqs).toContainEqual({ op: "eq", args: ["group_id", "group_1"] });

    // The contacts query constrains to the (deduped) member ids — never a
    // contacts.contact_group_id column filter.
    expect(eqs).not.toContainEqual({ op: "eq", args: ["contact_group_id", "group_1"] });
    expect(calls).toContainEqual({ op: "in", args: ["id", ["c1", "c2"]] });

    expect(result.emails).toEqual(["a@example.com", "b@example.com"]);
  });

  test("contactGroupId with no members returns the zero-eligible shape without error", async () => {
    const { client } = createMockSupabase([
      { data: [] }, // membership read → no members
      { data: [] }, // contacts read constrained to .in("id", []) → empty
    ]);

    const result = await materializeSegment(
      "tenant_1",
      { contactGroupId: "group_empty" },
      "list",
      { client },
    );

    expect(result).toEqual({
      segmentCount: 0,
      optedOutCount: 0,
      materializedCount: 0,
      listId: 0,
      emails: [],
    });
  });
});
