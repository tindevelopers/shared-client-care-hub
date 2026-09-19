#!/usr/bin/env node
/**
 * Release-gate validation for workspace packages: explicit (non-wildcard)
 * exports whose targets EXIST, MIT license metadata, a package-local
 * LICENSE file, and packed publishability — every `workspace:` dependency
 * specifier must resolve to a workspace package with a concrete version so
 * `pnpm pack`/publish rewrites it (source workspace ranges are allowed;
 * unrewritable ones are not).
 *
 * Export-target existence only means something against freshly built output,
 * so `pnpm quality` runs this AFTER `pnpm build`. The optional positional
 * argument points the validator at another packages directory (used by
 * tests/boundary/package-exports.test.ts to drive it against deterministic
 * temporary fixtures instead of the gitignored `dist`); it defaults to the
 * real workspace packages directory.
 *
 * Usage: node scripts/validate-packages.mjs [packagesDir]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = process.argv[2] ? resolve(process.argv[2]) : resolve(root, "packages");
const errors = [];

function validateExport(packageRoot, subpath, value) {
  if (subpath.includes("*")) {
    errors.push(`${packageRoot}: wildcard export "${subpath}" is not allowed`);
  }

  if (typeof value === "string") {
    if (value.includes("*")) {
      errors.push(`${packageRoot}: wildcard export target "${value}" is not allowed`);
    }
    if (!existsSync(resolve(packageRoot, value))) {
      errors.push(`${packageRoot}: export target "${value}" does not exist`);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const target of Object.values(value)) {
      validateExport(packageRoot, subpath, target);
    }
  }
}

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

// name → concrete version for every package in the workspace directory, so
// `workspace:` specifiers can be proven rewritable at pack/publish time.
const workspaceVersions = new Map();
for (const packageDir of readdirSync(packagesDir)) {
  const manifestPath = resolve(packagesDir, packageDir, "package.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name && typeof manifest.version === "string" && manifest.version.length > 0) {
    workspaceVersions.set(manifest.name, manifest.version);
  }
}

for (const packageDir of readdirSync(packagesDir)) {
  const packageRoot = resolve(packagesDir, packageDir);
  const manifestPath = resolve(packageRoot, "package.json");
  if (!existsSync(manifestPath)) continue;

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const label = manifest.name ?? packageDir;

  if (manifest.license !== "MIT") {
    errors.push(`${label}: package.json license must be MIT`);
  }
  if (!existsSync(resolve(packageRoot, "LICENSE"))) {
    errors.push(`${label}: package-local LICENSE is missing`);
  }

  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    validateExport(packageRoot, subpath, value);
  }

  for (const field of DEP_FIELDS) {
    for (const [dep, specifier] of Object.entries(manifest[field] ?? {})) {
      if (!String(specifier).startsWith("workspace:")) continue;
      if (!workspaceVersions.has(dep)) {
        errors.push(
          `${label}: ${field} "${dep}": workspace specifier cannot be rewritten for publish — no workspace package provides a concrete version`,
        );
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log("Package exports and MIT metadata are valid.");
}
