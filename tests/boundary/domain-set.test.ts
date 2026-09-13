/**
 * Enforcement input #4 analog: binds the set of packages/domain-* directories
 * on disk to the domain enumeration inside .dependency-cruiser.cjs.
 *
 * The R5 pair enumerates domain packages by name. If a new packages/domain-*
 * directory appears without a matching enumeration (or the config names a
 * domain that no longer exists), boundary enforcement has silently drifted
 * from reality — the new domain could import its siblings un-checked. This
 * meta-test fails in both directions, naming the mismatch.
 */
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireCjs = createRequire(import.meta.url);

type DepCruiseRule = {
  from?: { path?: string | string[] };
  to?: { path?: string | string[] };
};

function domainsOnDisk(): string[] {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("domain-"))
    .map((entry) => entry.name)
    .sort();
}

function domainsEnumeratedInConfig(): string[] {
  const config = requireCjs(resolve(root, ".dependency-cruiser.cjs")) as {
    forbidden?: DepCruiseRule[];
  };
  const names = new Set<string>();
  const patterns: string[] = [];
  for (const rule of config.forbidden ?? []) {
    for (const p of [rule.from?.path, rule.to?.path]) {
      if (typeof p === "string") patterns.push(p);
      else if (Array.isArray(p)) patterns.push(...p);
    }
  }
  for (const pattern of patterns) {
    for (const match of pattern.matchAll(/packages\/(domain-[a-z0-9-]+)\//g)) {
      names.add(match[1]!);
    }
  }
  return [...names].sort();
}

describe("domain-set meta-test", () => {
  it("packages/domain-* on disk equals the .dependency-cruiser.cjs enumeration", () => {
    const onDisk = domainsOnDisk();
    const enumerated = domainsEnumeratedInConfig();
    const onDiskOnly = onDisk.filter((d) => !enumerated.includes(d));
    const enumeratedOnly = enumerated.filter((d) => !onDisk.includes(d));
    expect(
      { onDiskOnly, enumeratedOnly },
      "domain-set drift between packages/ and .dependency-cruiser.cjs — " +
        `on disk only: [${onDiskOnly.join(", ")}]; ` +
        `enumerated in config only: [${enumeratedOnly.join(", ")}]. ` +
        "Add the new domain to the R5 pair (and every domain-scoped rule) in " +
        ".dependency-cruiser.cjs, or remove the stale directory, so boundary " +
        "enforcement cannot silently drift from the real package set.",
    ).toEqual({ onDiskOnly: [], enumeratedOnly: [] });
  });
});
