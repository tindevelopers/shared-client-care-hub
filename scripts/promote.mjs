#!/usr/bin/env node
// Promotes a published version from the `next` dist-tag to `latest`
// (VAL-REL-021). This is a TAG MOVE (`npm dist-tag add <pkg>@<version> latest`),
// never a republish under a new version — published versions are immutable.
//
// Usage:
//   node scripts/promote.mjs <package> <version> [--dry-run]
//
// <package> is one of the five workspace packages, either the short directory
// name (core-kernel) or the full name (@tindevelopers/core-kernel).
//
// Two guards run BEFORE any dist-tag change; a refused promotion exits 1
// without touching the registry:
//   1. Target-version guard — the version must exist on the registry
//      (`npm view <pkg>@<version> version` succeeds). Refuses to tag a
//      version that was never published.
//   2. Monotonicity guard — the version must be strictly semver-greater than
//      the package's current `latest`. Refuses any lower-or-equal move, so
//      `latest` can never go backward.
//
// --dry-run runs both guards and prints the decision without mutating any tag.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REGISTRY = "https://npm.pkg.github.com";
const TAG_TO_MOVE = "latest";

/** Parses "major.minor.patch[-prerelease][+build]" per semver 2.0.0. */
export function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
    version,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    // Build metadata (the +suffix) is ignored for precedence and dropped here.
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

/** Compares two semver strings: -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) {
    throw new Error(`compareVersions: not valid semver (${!left ? a : b})`);
  }
  for (const part of ["major", "minor", "patch"]) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  // A version WITHOUT a prerelease outranks the same version WITH one.
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;
  const length = Math.min(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      if (Number(l) !== Number(r)) return Number(l) < Number(r) ? -1 : 1;
    } else if (lNum !== rNum) {
      return lNum ? -1 : 1; // numeric identifiers sort below alphanumeric ones
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  if (left.prerelease.length !== right.prerelease.length) {
    return left.prerelease.length < right.prerelease.length ? -1 : 1;
  }
  return 0;
}

function fail(message) {
  console.error(`promote: ${message}`);
  process.exit(1);
}

function npmView(args) {
  try {
    return {
      ok: true,
      stdout: execFileSync("npm", ["view", ...args, `--registry=${REGISTRY}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    return { ok: false, stderr: String(error.stderr ?? "") };
  }
}

/** Resolves the user-supplied package argument to a workspace package. */
function resolveWorkspacePackage(userInput) {
  const wanted = userInput.startsWith("@") ? userInput : `@tindevelopers/${userInput}`;
  const packagesDir = join(process.cwd(), "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === wanted) {
        return { name: manifest.name, directory: entry.name };
      }
    } catch {
      // not a package directory — skip
    }
  }
  return null;
}

function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  if (positional.length !== 2) {
    fail("usage: node scripts/promote.mjs <package> <version> [--dry-run]");
  }
  const [packageArg, versionArg] = positional;

  const pkg = resolveWorkspacePackage(packageArg);
  if (!pkg) {
    fail(
      `unknown package "${packageArg}" — expected one of the workspace packages under packages/`,
    );
  }
  if (!parseSemver(versionArg)) {
    fail(`"${versionArg}" is not valid semver (major.minor.patch[-prerelease])`);
  }

  // Guard 1 — target-version guard: the version must exist on the registry.
  const target = npmView([`${pkg.name}@${versionArg}`, "version"]);
  if (!target.ok) {
    const reason =
      target.stderr
        .split("\n")
        .find((line) => line.includes("npm error"))?.trim() ?? "not found";
    fail(
      `target-version guard refused: ${pkg.name}@${versionArg} is not published on ${REGISTRY} (${reason})`,
    );
  }

  // Guard 2 — monotonicity guard: strictly greater than the current `latest`.
  // Qualified with a version range (rather than a bare package name, which
  // npm resolves against the "latest" dist-tag) so a package published only
  // under a non-latest tag (e.g. shipped to "next", not yet promoted — the
  // exact case this guard exists to handle) still resolves. Without this,
  // npm silently exits 0 with empty stdout when "latest" doesn't exist.
  const distTags = npmView([`${pkg.name}@>=0.0.0`, "dist-tags", "--json"]);
  if (!distTags.ok) {
    fail(`could not read dist-tags for ${pkg.name}: ${distTags.stderr.trim()}`);
  }
  let tags = {};
  try {
    const parsed = JSON.parse(distTags.stdout);
    // A range matching exactly one version prints that field's value
    // directly (a plain object); a range matching several prints one copy
    // per matched version (an array of objects). A real dist-tags value is
    // never itself an array.
    tags = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    fail(`could not parse dist-tags for ${pkg.name}`);
  }
  const currentLatest = tags[TAG_TO_MOVE];
  if (currentLatest !== undefined) {
    const ordering = compareVersions(versionArg, currentLatest);
    if (ordering <= 0) {
      fail(
        `monotonicity guard refused: refusing to move ${TAG_TO_MOVE} of ${pkg.name} from ${currentLatest} to a lower-or-equal version ${versionArg}`,
      );
    }
  }

  console.log(`promote: ${pkg.name} ${TAG_TO_MOVE} ${currentLatest ?? "(unset)"} -> ${versionArg}`);
  if (tags.next !== undefined && tags.next !== versionArg) {
    console.log(`promote: note: the next tag currently points at ${tags.next}, not ${versionArg}`);
  }
  const command = `npm dist-tag add ${pkg.name}@${versionArg} ${TAG_TO_MOVE} --registry=${REGISTRY}`;
  if (dryRun) {
    console.log(`promote: DRY RUN — guards passed; would run: ${command}`);
    return;
  }
  execFileSync("npm", ["dist-tag", "add", `${pkg.name}@${versionArg}`, TAG_TO_MOVE, `--registry=${REGISTRY}`], {
    stdio: "inherit",
  });
  console.log(`promote: done — ${command}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2));
}
