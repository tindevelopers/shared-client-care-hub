/**
 * Proves each dependency-cruiser rule in this hub can fail. Acceptance
 * criterion for Phase 0: a rule that never fires is not enforcement.
 *
 * Each case writes a temporary violating fixture into packages/, runs
 * depcruise, asserts the named rule fired, then removes the fixture
 * (afterEach). The final baseline case proves the committed tree is clean.
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG = ".dependency-cruiser.cjs";
const require = createRequire(import.meta.url);
const config = require(resolve(root, CONFIG)) as {
  forbidden: Array<{ name: string }>;
};
const created: string[] = [];
/**
 * Directories to rmdir ONLY when empty after fixture removal. Never rmSync'd
 * recursively: `packages/<pkg>/node_modules` is a real pnpm symlink farm once
 * a package has dependencies (domain-contacts gained the first ones), and
 * rmSync(recursive, force) on it deletes the package's entire install.
 */
const pruneIfEmpty: string[] = [];

function fixture(relPath: string, contents: string): void {
  const abs = resolve(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents, "utf-8");
  created.push(relPath);
}

/**
 * Fabricates a resolvable bare-name module inside a workspace package's own
 * node_modules (the fabricated module dir is removed in afterEach; the
 * package's node_modules itself is only pruned when the fixture leaves it
 * empty). Used to prove the resolved node_modules-path half of rules-fire
 * coverage without installing a real (and hub-forbidden) vendor SDK.
 */
function vendorModuleFixture(pkg: string, name: string): void {
  const base = `packages/${pkg}/node_modules/${name}`;
  fixture(
    `${base}/package.json`,
    `${JSON.stringify({ name, version: "0.0.0-fixture", main: "index.js" })}\n`,
  );
  fixture(`${base}/index.js`, "module.exports = {};\n");
  created.push(base);
  pruneIfEmpty.push(`packages/${pkg}/node_modules`);
}

afterEach(() => {
  for (const rel of created.splice(0)) {
    rmSync(resolve(root, rel), { recursive: true, force: true });
  }
  for (const rel of pruneIfEmpty.splice(0)) {
    try {
      rmdirSync(resolve(root, rel));
    } catch {
      // Not empty — the package has a real node_modules; keep it.
    }
  }
});

function depcruiseReport(): { exitCode: number; out: string } {
  let out = "";
  let exitCode = 0;
  try {
    out = execFileSync(
      "pnpm",
      ["depcruise", "--config", CONFIG, "--output-type", "json", "packages"],
      { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    exitCode = e.status ?? 1;
    out = e.stdout ?? "";
  }
  return { exitCode, out };
}

function firstJsonDocument(out: string): unknown {
  // pnpm prepends engine warnings to stdout and appends an ELIFECYCLE banner
  // when the depcruise script exits non-zero (the exit-code wrapper makes
  // error-severity violations do exactly that). The report is the first
  // balanced JSON document on the stream, so scan for it brace-balanced,
  // string-aware — never parse the surrounding noise.
  const start = out.search(/^\{/m);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < out.length; i++) {
    const ch = out[i] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(out.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

// dependency-cruiser v16 records violations in summary.violations (modules
// carry `source`, dependencies carry `rules`).
function violatedRules(out: string): string[] {
  try {
    const json = firstJsonDocument(out) as
      | { summary?: { violations?: Array<{ rule: { name: string } }> } }
      | undefined;
    const names = new Set<string>();
    for (const v of json?.summary?.violations ?? []) names.add(v.rule.name);
    return [...names];
  } catch {
    return [];
  }
}

function violationsOf(out: string): Array<{ rule: string; from: string; to: string }> {
  try {
    const json = firstJsonDocument(out) as
      | {
          summary?: {
            violations?: Array<{
              rule?: { name?: string };
              from?: string;
              to?: string;
            }>;
          };
        }
      | undefined;
    return (json?.summary?.violations ?? []).map((v) => ({
      rule: v.rule?.name ?? "",
      from: v.from ?? "",
      to: v.to ?? "",
    }));
  } catch {
    return [];
  }
}

function cruisedSources(out: string): string[] {
  try {
    const json = firstJsonDocument(out) as
      | { modules?: Array<{ source?: string }> }
      | undefined;
    return (json?.modules ?? [])
      .map((mod) => mod.source ?? "")
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

describe("dependency-cruiser boundary rules fire", () => {
  it("declares the UI CRM boundary rules", () => {
    const ruleNames = config.forbidden.map((rule) => rule.name);
    expect(ruleNames).toContain("no-ui-crm-host-runtime-imports");
    expect(ruleNames).toContain("no-domain-import-ui-crm");
  });

  it("R5: domain-contacts importing domain-campaigns is caught", () => {
    fixture(
      "packages/domain-contacts/src/__violation.ts",
      'import { x } from "@tindevelopers/domain-campaigns";\nexport const y = x;\n',
    );
    const { out } = depcruiseReport();
    expect(violatedRules(out)).toContain("no-domain-to-domain");
  });

  it("R5 reverse: domain-campaigns importing domain-contacts is caught", () => {
    fixture(
      "packages/domain-campaigns/src/__violation.ts",
      'import { x } from "@tindevelopers/domain-contacts";\nexport const y = x;\n',
    );
    const { out } = depcruiseReport();
    expect(violatedRules(out)).toContain("no-domain-to-domain-reverse");
  });

  it("R1: a domain importing a vendor SDK is caught (unresolved specifier)", () => {
    // No vendor SDK is (or ever may be) installed in this hub, so `stripe`
    // stays unresolved and the bare-specifier alternative of the rule is
    // what fires — the everyday violation shape.
    fixture(
      "packages/domain-contacts/src/__violation.ts",
      'import Stripe from "stripe";\nexport const s = Stripe;\n',
    );
    const { out } = depcruiseReport();
    expect(violatedRules(out)).toContain("no-vendor-in-domain");
  });

  it("R1: vendor ban fires on the RESOLVED node_modules path", () => {
    // Fabricate the smallest resolvable vendor module inside the fixture
    // package's own node_modules, so the import RESOLVES and only the
    // rule's node_modules/<vendor>/ matcher can catch it. This case FAILS
    // if options.exclude ever lists node_modules again — the resolved edge
    // would be stripped from the graph before rule evaluation (scrutiny
    // round 1 blocking issue).
    vendorModuleFixture("domain-contacts", "stripe");
    fixture(
      "packages/domain-contacts/src/__violation.ts",
      'import Stripe from "stripe";\nexport const s = Stripe;\n',
    );
    const { out } = depcruiseReport();
    const hit = violationsOf(out).find((v) => v.rule === "no-vendor-in-domain");
    expect(hit).toBeTruthy();
    expect(hit?.to).toContain("node_modules/stripe");
  });

  it("packages may not import the Next.js '@/' alias", () => {
    fixture(
      "packages/domain-campaigns/src/__violation.ts",
      'import { z } from "@/src/core/telemetry";\nexport const w = z;\n',
    );
    const { out } = depcruiseReport();
    expect(violatedRules(out)).toContain("no-apps-import");
  });

  it("ui-crm may not import host runtime dependencies", () => {
    fixture(
      "packages/ui-crm/src/__violation.ts",
      'import { redirect } from "next/navigation";\nexport const r = redirect;\n',
    );
    const { out } = depcruiseReport();
    expect(violatedRules(out)).toContain("no-ui-crm-host-runtime-imports");
  });

  it("domain packages may not import ui-crm", () => {
    fixture(
      "packages/domain-contacts/src/__violation.ts",
      'import { CrmShell } from "@tindevelopers/ui-crm";\nexport const shell = CrmShell;\n',
    );
    const { out } = depcruiseReport();
    expect(violatedRules(out)).toContain("no-domain-import-ui-crm");
  });

  it("domains never import core-kernel's admin-client — RESOLVED node_modules path", () => {
    // core-kernel@1.0.0 is a real root devDependency, so this import
    // RESOLVES (exports-map wildcard ./* -> ./dist/*.js) to
    // .../node_modules/@tindevelopers/core-kernel/dist/database/admin-client.js
    // and only the rule's node_modules-path alternatives can match — exactly
    // the "declared and installed and the import resolves" scenario of
    // VAL-HUB-011. This case FAILS if options.exclude ever lists node_modules
    // again (resolved edge stripped before rule evaluation), and also if the
    // core-kernel devDependency is removed (nothing left to resolve).
    fixture(
      "packages/domain-contacts/src/__violation.ts",
      'import { createAdminClient } from "@tindevelopers/core-kernel/database/admin-client";\nexport const c = createAdminClient;\n',
    );
    const { out } = depcruiseReport();
    const hit = violationsOf(out).find(
      (v) => v.rule === "domains-never-import-admin-client",
    );
    expect(hit).toBeTruthy();
    expect(hit?.to).toContain("node_modules/@tindevelopers/core-kernel");
  });

  it("domain-contacts importing core-kernel is ALLOWED (correct direction)", () => {
    fixture(
      "packages/domain-contacts/src/__ok.ts",
      'import { createLogger } from "@tindevelopers/core-kernel/logger";\nexport const l = createLogger("x");\n',
    );
    const { out } = depcruiseReport();
    // core-kernel is installed and node_modules edges survive to rule
    // evaluation, so the allowed import is genuinely seen by every rule.
    // Assert NO rule fires from this fixture (not just one named rule) and
    // that the fixture was actually cruised, so "no violation" cannot mean
    // "the import was never seen".
    expect(
      violationsOf(out).filter((v) => v.from.includes("src/__ok.ts")),
    ).toEqual([]);
    expect(cruisedSources(out).some((s) => s.endsWith("src/__ok.ts"))).toBe(true);
  });

  it("baseline: with no fixtures, no rule fires", () => {
    const { exitCode, out } = depcruiseReport();
    expect(violatedRules(out)).toEqual([]);
    expect(exitCode).toBe(0);
  });
});
