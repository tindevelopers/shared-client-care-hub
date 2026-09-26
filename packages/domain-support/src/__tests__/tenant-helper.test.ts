import { describe, expect, it } from "vitest";
import { resolveSupportTenantId } from "../tenant-helper";

describe("resolveSupportTenantId", () => {
  it("resolves the actor's own tenant when present", () => {
    expect(resolveSupportTenantId({ currentTenantId: "tenant-1" })).toBe("tenant-1");
  });

  it("fails closed when no tenant scope resolves — never guesses another tenant", () => {
    expect(() => resolveSupportTenantId({ currentTenantId: null })).toThrowError(
      /^No tenant found\./,
    );
  });

  it("gives platform staff no special branch — a system operator with no tenant also fails closed", () => {
    // Platform staff reach a customer tenant through a support session
    // (impersonation), which resolves a normal currentTenantId like any
    // other actor. Without one, there is no fallback tenant to pick — the
    // old "first available tenant" fallback for system operators is gone.
    expect(() => resolveSupportTenantId({ currentTenantId: null })).toThrowError(
      "No tenant found. Please ensure you are associated with a tenant. " +
        "If you are a Platform Admin, please create a tenant first in Tenant Management.",
    );
  });
});
