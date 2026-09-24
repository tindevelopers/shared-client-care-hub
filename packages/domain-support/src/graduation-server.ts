/**
 * HOST WIRING HELPERS for the support graduation core (pure).
 *
 * The database-backed pieces (BindingStore over sync_bindings + the
 * credential seam, GraduationStore over support tables) are implemented by
 * the app host; this module composes them into `SupportGraduationDeps`
 * without touching a database client itself.
 *
 * The resolver pairs the adapter-kit binding registry's port with the
 * binding's canonical provider name — the name is the external_refs key
 * graduation uses for generic specialist lookups (no provider branches).
 */
import {
  resolveProvider as resolveBoundPort,
  type BindingStore,
  type SupportProvider,
} from "@tindevelopers/adapter-kit";
import type {
  GraduationStore,
  ResolvedSupportProvider,
  SupportGraduationDeps,
} from "./graduation.js";

export interface BindingResolverDeps {
  bindingStore: BindingStore;
  /** Injectable for tests; defaults to the adapter-kit binding registry. */
  resolvePort?(
    store: BindingStore,
    tenantId: string,
    capability: "support",
  ): Promise<SupportProvider | null>;
}

/** Build the named-provider resolver graduation depends on. */
export function createBindingProviderResolver(
  deps: BindingResolverDeps,
): SupportGraduationDeps["resolveProvider"] {
  const resolvePort = deps.resolvePort ?? resolveBoundPort;
  return async (tenantId: string): Promise<ResolvedSupportProvider | null> => {
    const port = await resolvePort(deps.bindingStore, tenantId, "support");
    if (!port) return null;
    const binding = await deps.bindingStore.getBinding(tenantId, "support");
    if (!binding) return null;
    return { name: binding.provider, port };
  };
}

/** Compose the graduation deps from host-provided pieces. */
export function createSupportDeps(
  store: GraduationStore,
  resolveProvider: SupportGraduationDeps["resolveProvider"],
): SupportGraduationDeps {
  return { store, resolveProvider };
}
