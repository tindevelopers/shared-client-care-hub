/**
 * Support handoff routing (pure).
 *
 * Routes are host-provided data (the app owns storage); the domain owns the
 * selection and validation policy: lowest priority number wins, and a route
 * that is not an Operations target MUST declare an explicit fallback — a
 * failed handoff with nowhere to go is rejected, never silently dropped.
 */
import type { SupportOutcome } from "./ticket-policy.js";

export interface SupportRoute {
  id: string;
  channels: readonly string[];
  trigger: SupportOutcome;
  target: { kind: "user" | "team" | "queue" | "sip" | "operations"; id: string };
  priority: number;
  fallbackRouteId?: string;
}

export interface HandoffDelivery {
  deliver(route: SupportRoute): Promise<void>;
}

export interface HandoffResult {
  routeId: string;
  fallbackUsed: boolean;
}

/**
 * Reject a route without an explicit fallback unless its target is
 * Operations — the terminal escalation point, which needs no fallback.
 */
export function assertHandoffRoute(route: SupportRoute): void {
  if (route.target.kind !== "operations" && !route.fallbackRouteId) {
    throw new Error(
      `Handoff route "${route.id}" targets "${route.target.kind}" and must declare an explicit fallbackRouteId.`,
    );
  }
}

/**
 * Select the route for a trigger: matching trigger (and channel, when
 * given), lowest priority number first. The selected route is validated.
 */
export function selectHandoffRoute(
  routes: readonly SupportRoute[],
  trigger: SupportOutcome,
  channel?: string,
): SupportRoute {
  const candidates = routes
    .filter((r) => r.trigger === trigger)
    .filter((r) => channel === undefined || r.channels.includes(channel))
    .sort((a, b) => a.priority - b.priority);
  const selected = candidates[0];
  if (!selected) {
    throw new Error(
      `No handoff route matches trigger "${trigger}"${channel ? ` on channel "${channel}"` : ""}.`,
    );
  }
  assertHandoffRoute(selected);
  return selected;
}

/** Resolve a route's declared fallback, or undefined when it has none. */
export function resolveFallbackRoute(
  routes: readonly SupportRoute[],
  route: SupportRoute,
): SupportRoute | undefined {
  if (!route.fallbackRouteId) return undefined;
  return routes.find((r) => r.id === route.fallbackRouteId);
}

/**
 * Deliver a handoff: select the route, attempt delivery, and on failure
 * fall back to the declared fallback route. A route without a fallback
 * (Operations) fails loudly — an escalation is never silently dropped.
 */
export async function performHandoff(
  routes: readonly SupportRoute[],
  trigger: SupportOutcome,
  delivery: HandoffDelivery,
  channel?: string,
): Promise<HandoffResult> {
  const route = selectHandoffRoute(routes, trigger, channel);
  try {
    await delivery.deliver(route);
    return { routeId: route.id, fallbackUsed: false };
  } catch (error) {
    const fallback = resolveFallbackRoute(routes, route);
    if (!fallback) throw error;
    assertHandoffRoute(fallback);
    await delivery.deliver(fallback);
    return { routeId: fallback.id, fallbackUsed: true };
  }
}
