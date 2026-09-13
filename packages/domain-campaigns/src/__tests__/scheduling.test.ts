/**
 * Characterization tests for nextAllowedStartUtc (VAL-CAMPAIGNS-004).
 *
 * The implementation is moved byte-identical from
 * `apps/app/src/core/campaigns/scheduling.ts` (verified by `diff` in the hub
 * gates); these tests pin its behavior so any future edit is caught:
 *   (a) fromUtc inside the tenant-local calling window returns fromUtc unchanged
 *   (b) before window start on an allowed day returns that day's window start (UTC)
 *   (c) after window end rolls to the next allowed day in calling_days
 *   (d) empty/null calling_days defaults to Mon–Fri [1,2,3,4,5]
 *   (e) a window crossing midnight (start > end) treats the gap [end, start) correctly
 *   (f) DST-sensitive zones resolve the local→UTC conversion consistently
 *
 * All expected instants are hand-computed and hardcoded — that is the point of
 * a characterization test. Day-of-week anchors: 2026-06-14 Sun, 2026-06-15 Mon,
 * 2026-06-16 Tue, 2026-01-15 Thu (EST), 2026-07-15 Wed (EDT).
 */
import { describe, expect, test } from "vitest";
import { nextAllowedStartUtc } from "../scheduling.js";

const NY = "America/New_York";

describe("nextAllowedStartUtc characterization", () => {
  test("(a) fromUtc inside the calling window is returned unchanged", () => {
    // 2026-06-15T19:00:00Z = 15:00 America/New_York (EDT, UTC-4), Monday.
    // Window 09:00–20:00 Mon–Fri: 15:00 is inside → same instant.
    const fromUtc = new Date("2026-06-15T19:00:00.000Z");
    const out = nextAllowedStartUtc({
      fromUtc,
      timeZone: NY,
      callingWindowStart: "09:00",
      callingWindowEnd: "20:00",
      callingDays: [1, 2, 3, 4, 5],
    });
    expect(out).toBe(fromUtc);
    expect(out.toISOString()).toBe("2026-06-15T19:00:00.000Z");
  });

  test("(b) before window start on an allowed day returns that day's window start", () => {
    // 2026-06-15T10:00:00Z = 06:00 NY Monday, before 09:00 → 09:00 EDT = 13:00 UTC.
    const out = nextAllowedStartUtc({
      fromUtc: new Date("2026-06-15T10:00:00.000Z"),
      timeZone: NY,
      callingWindowStart: "09:00",
      callingWindowEnd: "20:00",
      callingDays: [1, 2, 3, 4, 5],
    });
    expect(out.toISOString()).toBe("2026-06-15T13:00:00.000Z");
  });

  test("(c) after window end rolls to the next allowed day's window start", () => {
    // 2026-06-16T00:30:00Z = 20:30 NY Monday Jun 15, after 20:00 →
    // next allowed day Tue Jun 16 09:00 EDT = 13:00 UTC.
    const out = nextAllowedStartUtc({
      fromUtc: new Date("2026-06-16T00:30:00.000Z"),
      timeZone: NY,
      callingWindowStart: "09:00",
      callingWindowEnd: "20:00",
      callingDays: [1, 2, 3, 4, 5],
    });
    expect(out.toISOString()).toBe("2026-06-16T13:00:00.000Z");
  });

  test("(c') weekend rolls to Monday when Sat/Sun are not allowed", () => {
    // 2026-06-13 is a Saturday; window 09:00–20:00 Mon–Fri →
    // next allowed Monday 2026-06-15 09:00 EDT = 13:00 UTC.
    const out = nextAllowedStartUtc({
      fromUtc: new Date("2026-06-13T15:00:00.000Z"), // 11:00 NY Saturday
      timeZone: NY,
      callingWindowStart: "09:00",
      callingWindowEnd: "20:00",
      callingDays: [1, 2, 3, 4, 5],
    });
    expect(out.toISOString()).toBe("2026-06-15T13:00:00.000Z");
  });

  test("(d) null calling_days defaults to Mon–Fri", () => {
    // Sunday 2026-06-14 11:00 NY; days null → default [1,2,3,4,5] →
    // Monday 2026-06-15 09:00 EDT = 13:00 UTC.
    const out = nextAllowedStartUtc({
      fromUtc: new Date("2026-06-14T15:00:00.000Z"),
      timeZone: NY,
      callingWindowStart: "09:00",
      callingWindowEnd: "20:00",
      callingDays: null,
    });
    expect(out.toISOString()).toBe("2026-06-15T13:00:00.000Z");
  });

  test("(d') empty calling_days array also defaults to Mon–Fri", () => {
    const out = nextAllowedStartUtc({
      fromUtc: new Date("2026-06-14T15:00:00.000Z"), // Sunday 11:00 NY
      timeZone: NY,
      callingWindowStart: "09:00",
      callingWindowEnd: "20:00",
      callingDays: [],
    });
    expect(out.toISOString()).toBe("2026-06-15T13:00:00.000Z");
  });

  test("(e) window crossing midnight: the gap [end, start) waits for same-day start", () => {
    // Window 20:00→02:00 (start > end). Monday 2026-06-15 10:00 NY is in the
    // gap [02:00, 20:00) → same-day 20:00 EDT = 2026-06-16T00:00:00Z.
    const out = nextAllowedStartUtc({
      fromUtc: new Date("2026-06-15T14:00:00.000Z"), // 10:00 NY Monday
      timeZone: NY,
      callingWindowStart: "20:00",
      callingWindowEnd: "02:00",
      callingDays: [1, 2, 3, 4, 5],
    });
    expect(out.toISOString()).toBe("2026-06-16T00:00:00.000Z");
  });

  test("(e') window crossing midnight: inside the late-evening arm returns unchanged", () => {
    // Monday 2026-06-15 21:00 NY is inside [20:00, 24:00) → unchanged.
    const fromUtc = new Date("2026-06-16T01:00:00.000Z"); // 21:00 NY Monday
    const out = nextAllowedStartUtc({
      fromUtc,
      timeZone: NY,
      callingWindowStart: "20:00",
      callingWindowEnd: "02:00",
      callingDays: [1, 2, 3, 4, 5],
    });
    expect(out).toBe(fromUtc);
  });

  test("(f) DST-sensitive zone: same local window maps to different UTC offsets winter vs summer", () => {
    // Winter (EST, UTC-5): Thu 2026-01-15 07:00 NY → 09:00 EST = 14:00 UTC.
    const winter = nextAllowedStartUtc({
      fromUtc: new Date("2026-01-15T12:00:00.000Z"), // 07:00 EST
      timeZone: NY,
      callingWindowStart: "09:00",
      callingWindowEnd: "20:00",
      callingDays: [1, 2, 3, 4, 5],
    });
    expect(winter.toISOString()).toBe("2026-01-15T14:00:00.000Z");

    // Summer (EDT, UTC-4): Wed 2026-07-15 08:00 NY → 09:00 EDT = 13:00 UTC.
    const summer = nextAllowedStartUtc({
      fromUtc: new Date("2026-07-15T12:00:00.000Z"), // 08:00 EDT
      timeZone: NY,
      callingWindowStart: "09:00",
      callingWindowEnd: "20:00",
      callingDays: [1, 2, 3, 4, 5],
    });
    expect(summer.toISOString()).toBe("2026-07-15T13:00:00.000Z");

    // The two 09:00-local window starts differ by exactly the DST offset delta.
    const winterLocalNoonUtc = Date.parse("2026-01-15T14:00:00.000Z");
    const summerLocalNoonUtc = Date.parse("2026-07-15T13:00:00.000Z");
    expect(winterLocalNoonUtc).not.toBe(summerLocalNoonUtc);
  });

  test("fallback window defaults apply (09:00–20:00) when window strings are null", () => {
    // Null window strings fall back to 09:00–20:00 (parseHmToMinutes fallback):
    // Sunday 2026-06-14 05:00 NY is outside default days → Monday 09:00 EDT.
    const out = nextAllowedStartUtc({
      fromUtc: new Date("2026-06-14T09:00:00.000Z"), // 05:00 NY Sunday
      timeZone: NY,
      callingWindowStart: null as unknown as string,
      callingWindowEnd: null as unknown as string,
      callingDays: [1, 2, 3, 4, 5],
    });
    expect(out.toISOString()).toBe("2026-06-15T13:00:00.000Z");
  });
});
