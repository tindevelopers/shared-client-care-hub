import { describe, expect, it } from "vitest";
import { accessGrantState, validateAccessRequest } from "../access";

const now = new Date("2026-09-24T12:00:00Z");

describe("accessGrantState", () => {
  it("passes non-approved statuses through", () => {
    for (const status of ["pending", "denied", "revoked"] as const) {
      expect(accessGrantState({ status, starts_at: null, expires_at: null }, now)).toBe(status);
    }
  });

  it("is active only between starts_at and expires_at", () => {
    const grant = { status: "approved" as const, starts_at: "2026-09-24T11:00:00Z", expires_at: "2026-09-24T13:00:00Z" };
    expect(accessGrantState(grant, now)).toBe("active");
    expect(accessGrantState(grant, new Date("2026-09-24T13:00:00Z"))).toBe("expired");
    expect(accessGrantState(grant, new Date("2026-09-24T10:59:59Z"))).toBe("expired");
  });

  it("treats an approved grant without times as expired", () => {
    expect(accessGrantState({ status: "approved", starts_at: null, expires_at: null }, now)).toBe("expired");
  });
});

describe("validateAccessRequest", () => {
  it("requires a reason", () => {
    expect(validateAccessRequest({ reason: "  " })).toMatch(/reason/);
  });

  it("bounds hours to 1..168 whole hours", () => {
    expect(validateAccessRequest({ reason: "x", hours: 0 })).toMatch(/1 to 168/);
    expect(validateAccessRequest({ reason: "x", hours: 169 })).toMatch(/1 to 168/);
    expect(validateAccessRequest({ reason: "x", hours: 1.5 })).toMatch(/1 to 168/);
    expect(validateAccessRequest({ reason: "x", hours: 168 })).toBeNull();
    expect(validateAccessRequest({ reason: "x" })).toBeNull();
  });

  it("needs a 20-character reason for break-glass", () => {
    expect(validateAccessRequest({ reason: "outage", breakGlass: true })).toMatch(/20 characters/);
    expect(validateAccessRequest({ reason: "Production outage affecting billing", breakGlass: true })).toBeNull();
  });
});
