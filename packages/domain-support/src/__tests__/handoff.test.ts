import { describe, expect, it, vi } from "vitest";
import {
  performHandoff,
  selectHandoffRoute,
  resolveFallbackRoute,
  type SupportRoute,
} from "../handoff";

function route(overrides: Partial<SupportRoute> & Pick<SupportRoute, "id" | "trigger">): SupportRoute {
  return {
    channels: ["chat", "voice"],
    priority: 10,
    target: { kind: "team", id: "support-desk" },
    fallbackRouteId: "route-fallback",
    ...overrides,
  };
}

const fallback: SupportRoute = route({
  id: "route-fallback",
  trigger: "human_handoff",
  priority: 50,
  target: { kind: "operations", id: "ops-queue" },
  fallbackRouteId: undefined,
});

describe("selectHandoffRoute", () => {
  it("selects the matching trigger route with the lowest priority number", () => {
    const routes = [
      route({ id: "b", trigger: "human_handoff", priority: 20 }),
      route({ id: "a", trigger: "human_handoff", priority: 1 }),
      route({ id: "c", trigger: "ticket_requested", priority: 0 }),
      fallback,
    ];
    expect(selectHandoffRoute(routes, "human_handoff").id).toBe("a");
  });

  it("filters by channel when one is given", () => {
    const routes = [
      route({ id: "chat-only", trigger: "human_handoff", channels: ["chat"], priority: 1 }),
      route({ id: "voice-only", trigger: "human_handoff", channels: ["voice"], priority: 2 }),
      fallback,
    ];
    expect(selectHandoffRoute(routes, "human_handoff", "voice").id).toBe("voice-only");
  });

  it("throws when no route matches the trigger", () => {
    expect(() => selectHandoffRoute([fallback], "human_handoff", "sms")).toThrowError(
      /no handoff route/i,
    );
  });

  it("rejects a non-Operations route without an explicit fallback", () => {
    const orphan = route({ id: "orphan", trigger: "human_handoff", fallbackRouteId: undefined });
    expect(() => selectHandoffRoute([orphan], "human_handoff")).toThrowError(/fallback/i);
  });

  it("accepts an Operations route without a fallback", () => {
    const ops = route({
      id: "ops",
      trigger: "operations_escalation",
      target: { kind: "operations", id: "ops-queue" },
      fallbackRouteId: undefined,
    });
    expect(selectHandoffRoute([ops], "operations_escalation").id).toBe("ops");
  });
});

describe("resolveFallbackRoute", () => {
  it("resolves the declared fallback by id", () => {
    const primary = route({ id: "primary", trigger: "human_handoff" });
    expect(resolveFallbackRoute([primary, fallback], primary)?.id).toBe("route-fallback");
  });

  it("returns undefined when the route declares no fallback", () => {
    const ops = route({
      id: "ops",
      trigger: "operations_escalation",
      target: { kind: "operations", id: "ops-queue" },
      fallbackRouteId: undefined,
    });
    expect(resolveFallbackRoute([ops], ops)).toBeUndefined();
  });
});

describe("performHandoff", () => {
  it("delivers a successful human handoff through the selected route", async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const routes = [route({ id: "primary", trigger: "human_handoff" }), fallback];

    const result = await performHandoff(routes, "human_handoff", { deliver });

    expect(result).toEqual({ routeId: "primary", fallbackUsed: false });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0].id).toBe("primary");
  });

  it("falls back to the declared fallback route when the primary delivery fails", async () => {
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(new Error("desk unavailable"))
      .mockResolvedValueOnce(undefined);
    const routes = [route({ id: "primary", trigger: "human_handoff" }), fallback];

    const result = await performHandoff(routes, "human_handoff", { deliver });

    expect(result).toEqual({ routeId: "route-fallback", fallbackUsed: true });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[1][0].id).toBe("route-fallback");
  });

  it("escalates to Operations without a fallback and rethrows delivery failure", async () => {
    const routes = [fallback]; // operations target, no fallbackRouteId
    const deliver = vi.fn().mockRejectedValue(new Error("ops queue down"));

    await expect(performHandoff(routes, "human_handoff", { deliver })).rejects.toThrowError(
      "ops queue down",
    );
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("rethrows when the fallback delivery also fails", async () => {
    const deliver = vi.fn().mockRejectedValue(new Error("all desks down"));
    const routes = [route({ id: "primary", trigger: "human_handoff" }), fallback];

    await expect(performHandoff(routes, "human_handoff", { deliver })).rejects.toThrowError(
      "all desks down",
    );
    expect(deliver).toHaveBeenCalledTimes(2);
  });
});
