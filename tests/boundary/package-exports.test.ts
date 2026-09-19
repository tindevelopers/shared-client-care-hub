import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packagesDir = resolve(root, "packages");

type ExportConditions = {
  types?: string;
  import?: string;
  default?: string;
};

describe("package exports", () => {
  for (const packageDir of readdirSync(packagesDir)) {
    const packageRoot = resolve(packagesDir, packageDir);
    const manifestPath = resolve(packageRoot, "package.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name: string;
      exports?: Record<string, ExportConditions>;
    };

    it(`${manifest.name} export targets exist after build`, () => {
      for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
        for (const condition of ["types", "import", "default"] as const) {
          const target = conditions[condition];
          expect(target, `${subpath} must define ${condition}`).toBeTypeOf("string");
          expect(
            existsSync(resolve(packageRoot, target as string)),
            `${subpath} ${condition} target ${target} must exist`,
          ).toBe(true);
        }
      }
    });
  }
});
