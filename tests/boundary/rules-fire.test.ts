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
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG = ".dependency-cruiser.cjs";
const created: string[] = [];

function fixture(relPath: string, contents: string): void {
  const abs = resolve(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents, "utf-8");
  created.push(relPath);
}

afterEach(() => {
  for (const rel of created.splice(0)) {
    const abs = resolve(root, rel);
    if (existsSync(abs)) rmSync(abs);
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

  it("R1: a domain importing a vendor SDK is caught", () => {
    fixture(
      "packages/domain-contacts/src/__violation.ts",
      'import Stripe from "stripe";\nexport const s = Stripe;\n',
    );
    const { out } = depcruiseReport();
    expect(violatedRules(out)).toContain("no-vendor-in-domain");
  });

  it("packages may not import the Next.js '@/' alias", () => {
    fixture(
      "packages/domain-campaigns/src/__violation.ts",
      'import { z } from "@/src/core/telemetry";\nexport const w = z;\n',
    );
    const { out } = depcruiseReport();
    expect(violatedRules(out)).toContain("no-apps-import");
  });

  it("domains never import core-kernel's admin-client (bare specifier)", () => {
    fixture(
      "packages/domain-contacts/src/__violation.ts",
      'import { createAdminClient } from "@tindevelopers/core-kernel/database/admin-client";\nexport const c = createAdminClient;\n',
    );
    const { out } = depcruiseReport();
    expect(violatedRules(out)).toContain("domains-never-import-admin-client");
  });

  it("domain-contacts importing core-kernel is ALLOWED (correct direction)", () => {
    fixture(
      "packages/domain-contacts/src/__ok.ts",
      'import { createLogger } from "@tindevelopers/core-kernel/logger";\nexport const l = createLogger("x");\n',
    );
    const { out } = depcruiseReport();
    expect(violatedRules(out)).not.toContain("no-domain-to-domain");
    // Prove the fixture was actually cruised, so "no violation" cannot mean
    // "the import was never seen". The core-kernel edge itself is invisible
    // in this report: it resolves into node_modules, which the config's
    // exclude.path strips from the JSON output. Parsing of this exact import
    // shape is proven by the domain-campaigns case above, so "module cruised
    // + rule did not fire" is the strongest signal available that the allowed
    // direction was evaluated, not missed.
    expect(cruisedSources(out).some((s) => s.endsWith("src/__ok.ts"))).toBe(true);
  });

  it("baseline: with no fixtures, no rule fires", () => {
    const { exitCode, out } = depcruiseReport();
    expect(violatedRules(out)).toEqual([]);
    expect(exitCode).toBe(0);
  });
});
