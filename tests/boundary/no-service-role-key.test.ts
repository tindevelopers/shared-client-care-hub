/**
 * No package may read SUPABASE_SERVICE_ROLE_KEY from the environment.
 *
 * The ban is UNCONDITIONAL in this hub: service-role access is
 * injection-only. Domain packages receive a service-role SupabaseClient
 * through their public API (the app composes them); they never construct or
 * read one themselves. No package here has a kernel role, so there are no
 * exemptions — if a future package ever needs a kernel-like exception, it
 * gets its own ruling, not a silent exemption.
 *
 * Scans raw source rather than resolving modules, so it catches the read even
 * when it is hidden behind a dynamic import or a computed property name.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BANNED = "SUPABASE_SERVICE_ROLE_KEY";
const EXEMPT_PACKAGES: string[] = [];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) yield* walk(abs);
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry)) yield abs;
  }
}

describe(`no package reads ${BANNED}`, () => {
  const offenders: string[] = [];
  for (const file of walk(resolve(root, "packages"))) {
    if (file.includes("__tests__") || file.endsWith(".test.ts")) continue;
    const rel = relative(root, file);
    if (EXEMPT_PACKAGES.some((pkg) => rel.startsWith(`packages/${pkg}/`))) continue;
    if (readFileSync(file, "utf-8").includes(BANNED)) {
      offenders.push(rel);
    }
  }

  it("finds no reads of the service-role key", () => {
    expect(offenders).toEqual([]);
  });
});
