/**
 * Covers package export/release validation without depending on gitignored
 * build output (`dist` is not committed, so any test that reads it is not
 * clean-checkout safe and can be fooled by stale artifacts):
 *
 * - The validator CLI (scripts/validate-packages.mjs) is exercised against
 *   deterministic temporary fixture packages, proving the accept path and
 *   every rejection path (missing export target, wildcard subpath, wildcard
 *   target, non-MIT license, missing package-local LICENSE).
 * - The real workspace manifests are checked only for committed facts:
 *   explicit export shape pointing into ./dist/, MIT metadata, LICENSE file.
 * - Export-target EXISTENCE is validated by `pnpm validate:packages`, which
 *   `pnpm quality` runs after `pnpm build` — so it always inspects freshly
 *   built output, never a stale dist. The ordering itself is asserted below.
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const validator = resolve(root, "scripts/validate-packages.mjs");
const packagesDir = resolve(root, "packages");

/** Temp fixture roots, removed after each test (system tmpdir only). */
const tempDirs: string[] = [];

function fixturePackagesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "validate-packages-"));
  tempDirs.push(dir);
  return dir;
}

function fixturePackage(
  dir: string,
  name: string,
  manifest: unknown,
  files: Record<string, string> = {},
): void {
  const pkgRoot = join(dir, name);
  mkdirSync(pkgRoot, { recursive: true });
  writeFileSync(join(pkgRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(pkgRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, "utf-8");
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runValidator(dir: string): { exitCode: number; out: string } {
  try {
    const stdout = execFileSync(process.execPath, [validator, dir], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, out: stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { exitCode: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** A manifest that passes every check when its targets exist on disk. */
function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "@fixture/pkg",
    license: "MIT",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
      },
    },
    ...overrides,
  };
}

const builtFiles = {
  LICENSE: "MIT\n",
  "dist/index.js": "export {};\n",
  "dist/index.d.ts": "export {};\n",
};

describe("validate-packages CLI (temporary fixtures)", () => {
  it("accepts MIT metadata, LICENSE, and explicit export targets that exist", () => {
    const dir = fixturePackagesDir();
    fixturePackage(dir, "pkg", validManifest(), builtFiles);
    const { exitCode, out } = runValidator(dir);
    expect(out).toContain("valid");
    expect(exitCode).toBe(0);
  });

  it("rejects an export target missing from the build output", () => {
    const dir = fixturePackagesDir();
    // LICENSE present but no dist/ — exactly the clean-checkout shape: the
    // validator must fail until `pnpm build` has produced the targets.
    fixturePackage(dir, "pkg", validManifest(), { LICENSE: "MIT\n" });
    const { exitCode, out } = runValidator(dir);
    expect(exitCode).toBe(1);
    expect(out).toContain('export target "./dist/index.js" does not exist');
    expect(out).toContain('export target "./dist/index.d.ts" does not exist');
  });

  it("rejects wildcard export subpaths", () => {
    const dir = fixturePackagesDir();
    fixturePackage(
      dir,
      "pkg",
      validManifest({
        exports: { "./*": { default: "./dist/index.js" } },
      }),
      builtFiles,
    );
    const { exitCode, out } = runValidator(dir);
    expect(exitCode).toBe(1);
    expect(out).toContain('wildcard export "./*" is not allowed');
  });

  it("rejects wildcard export targets", () => {
    const dir = fixturePackagesDir();
    fixturePackage(
      dir,
      "pkg",
      validManifest({
        exports: { ".": { default: "./dist/*.js" } },
      }),
      builtFiles,
    );
    const { exitCode, out } = runValidator(dir);
    expect(exitCode).toBe(1);
    expect(out).toContain('wildcard export target "./dist/*.js" is not allowed');
  });

  it("rejects non-MIT license metadata", () => {
    const dir = fixturePackagesDir();
    fixturePackage(dir, "pkg", validManifest({ license: "UNLICENSED" }), builtFiles);
    const { exitCode, out } = runValidator(dir);
    expect(exitCode).toBe(1);
    expect(out).toContain("license must be MIT");
  });

  it("rejects a missing package-local LICENSE", () => {
    const dir = fixturePackagesDir();
    fixturePackage(dir, "pkg", validManifest(), {
      "dist/index.js": "export {};\n",
      "dist/index.d.ts": "export {};\n",
    });
    const { exitCode, out } = runValidator(dir);
    expect(exitCode).toBe(1);
    expect(out).toContain("package-local LICENSE is missing");
  });
});

type ExportConditions = {
  types?: string;
  import?: string;
  default?: string;
};

describe("workspace package manifests (committed facts only)", () => {
  for (const packageDir of readdirSync(packagesDir)) {
    const packageRoot = resolve(packagesDir, packageDir);
    const manifestPath = resolve(packageRoot, "package.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name: string;
      license?: string;
      exports?: Record<string, ExportConditions>;
    };

    it(`${manifest.name} declares explicit MIT-licensed exports into ./dist/`, () => {
      expect(manifest.license).toBe("MIT");
      // LICENSE is git-tracked, so this holds on a clean checkout too.
      expect(existsSync(resolve(packageRoot, "LICENSE"))).toBe(true);

      const exportsMap = manifest.exports ?? {};
      expect(Object.keys(exportsMap).length).toBeGreaterThan(0);
      for (const [subpath, conditions] of Object.entries(exportsMap)) {
        expect(subpath.includes("*"), `${subpath} must not be a wildcard subpath`).toBe(
          false,
        );
        for (const condition of ["types", "import", "default"] as const) {
          const target = conditions[condition];
          expect(target, `${subpath} must define ${condition}`).toBeTypeOf("string");
          expect(
            (target as string).includes("*"),
            `${subpath} ${condition} must not be a wildcard target`,
          ).toBe(false);
          expect(
            (target as string).startsWith("./dist/"),
            `${subpath} ${condition} must point into the build output`,
          ).toBe(true);
        }
      }
    });
  }

  it("quality validates packages against a fresh build (build before validate:packages)", () => {
    const { scripts } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const quality = scripts.quality;
    expect(quality).toContain("pnpm build");
    expect(quality).toContain("pnpm validate:packages");
    expect(quality.indexOf("pnpm build")).toBeLessThan(
      quality.indexOf("pnpm validate:packages"),
    );
  });
});
