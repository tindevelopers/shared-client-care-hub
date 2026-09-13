/**
 * Hub vitest global setup — neutralizes the React `server-only` guard so
 * server-only modules (the moved suppression / crm-sync subscribers) can be
 * imported in the Node test environment. Mirrors the konnect consumer's
 * vitest.setup.ts convention; the guard itself survives verbatim in the
 * package source and dist (VAL-CONTACTS-020).
 */
import { vi } from "vitest";

// "server-only" throws when imported outside a React Server Component. Vitest
// runs in plain Node, so make it a no-op.
vi.mock("server-only", () => ({ default: {} }));
