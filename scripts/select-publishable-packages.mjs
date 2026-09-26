#!/usr/bin/env node
// Selects the workspace packages that need publishing and prints them in
// dependency order (VAL-REL-013). A package is selected when its workspace
// version does not yet exist on the registry, so a release created with
// nothing changed selects ZERO packages and publishes nothing instead of
// 403-ing into a partial release (VAL-REL-014).
//
// Usage:   node scripts/select-publishable-packages.mjs
// Output:  JSON array on stdout, in publish (dependency) order:
//          [{ "name": "@tindevelopers/core-kernel",
//             "directory": "packages/core-kernel",
//             "version": "1.0.1" }, ...]
//          Empty array (exit 0) when every workspace version is published.
// Exit:    0 on success (including an empty selection); 1 on tooling failure
//          (registry unreadable, malformed manifest, dependency cycle).
//
// Selection is derived from the registry — there is no hardcoded package
// list. Ordering is derived from the workspace dependency graph: a package
// publishes only in a strictly later "layer" than all of its workspace
// dependencies (architecture §7.2: core-kernel before its dependents,
// platform last), with alphabetical order inside a layer for determinism.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REGISTRY = "https://npm.pkg.github.com";
const CANARY_PACKAGE = "@tindevelopers/core-kernel"; // always published; proves registry read access

function fail(message) {
  console.error(`select-publishable-packages: ${message}`);
  process.exit(1);
}

function npmViewJson(args) {
  try {
    return {
      ok: true,
      stdout: execFileSync("npm", ["view", ...args, `--registry=${REGISTRY}`, "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    return { ok: false, stderr: String(error.stderr ?? "") };
  }
}

function loadWorkspacePackages() {
  const packagesDir = join(process.cwd(), "packages");
  const manifests = new Map(); // name -> { name, directory, version, workspaceDeps: Set<string> }
  const directories = readdirSync(packagesDir, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  for (const directory of directories) {
    const manifestPath = join(packagesDir, directory, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue; // no/readable package.json — not a publishing package
    }
    if (!manifest.name || !manifest.version || manifest.private === true) continue;
    manifests.set(manifest.name, {
      name: manifest.name,
      directory: join("packages", directory),
      version: manifest.version,
      workspaceDeps: new Set(),
    });
  }
  // Second pass: record dependencies that point at other workspace packages
  // (range format is irrelevant — only the name matters).
  for (const directory of directories) {
    const manifestPath = join(packagesDir, directory, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    const self = manifests.get(manifest.name);
    if (!self) continue;
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const dep of Object.keys(manifest[field] ?? {})) {
        if (dep !== manifest.name && manifests.has(dep)) self.workspaceDeps.add(dep);
      }
    }
  }
  return manifests;
}

/** Longest chain of workspace dependencies above this package (0 = no workspace deps). */
function layerOf(name, manifests, memo, visiting) {
  if (memo.has(name)) return memo.get(name);
  if (visiting.has(name)) fail(`dependency cycle detected involving ${name}`);
  visiting.add(name);
  let layer = 0;
  for (const dep of manifests.get(name).workspaceDeps) {
    layer = Math.max(layer, layerOf(dep, manifests, memo, visiting) + 1);
  }
  visiting.delete(name);
  memo.set(name, layer);
  return layer;
}

function main() {
  const manifests = loadWorkspacePackages();
  if (manifests.size === 0) fail("no publishing packages found under packages/");

  // Registry read-access canary: without it, an auth failure would look like
  // "nothing published" and the release would try to republish everything.
  const canary = npmViewJson([CANARY_PACKAGE, "version"]);
  if (!canary.ok) {
    fail(
      `cannot read ${CANARY_PACKAGE} from ${REGISTRY} — registry auth/read is broken (${canary.stderr.trim().split("\n")[0]})`,
    );
  }

  const selected = [];
  for (const pkg of manifests.values()) {
    // Qualify with a version range (rather than a bare package name, which
    // npm resolves against the "latest" dist-tag) so a package published
    // only under a non-latest tag (e.g. freshly shipped to "next", not yet
    // promoted) still resolves. Without this, npm silently exits 0 with
    // empty stdout when "latest" doesn't exist, which JSON.parse then
    // treats as a hard failure via the catch block below.
    const result = npmViewJson([`${pkg.name}@>=0.0.0`, "versions"]);
    let published = [];
    if (result.ok) {
      try {
        const parsed = JSON.parse(result.stdout);
        // A range matching exactly one version prints that field's value
        // directly (e.g. ["1.0.0"]); a range matching several prints one
        // copy of it per matched version (e.g. [["1.0.0","1.0.1"], [...]]).
        // A real "versions" value is never itself an array of arrays, so
        // that shape unambiguously signals the multi-match wrapper.
        const versions = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed[0] : parsed;
        published = Array.isArray(versions) ? versions : [String(versions)];
      } catch {
        fail(`could not parse published versions for ${pkg.name}`);
      }
    } else if (result.stderr.includes("E404")) {
      published = []; // package never published at all — publish is legitimate
    } else {
      fail(`could not read versions for ${pkg.name}: ${result.stderr.trim()}`);
    }
    if (!published.includes(pkg.version)) {
      selected.push(pkg);
      console.error(
        `select: ${pkg.name}@${pkg.version} is NOT published — selected (registry has ${
          published.length === 0 ? "no versions" : published.length + " versions, none at " + pkg.version
        })`,
      );
    } else {
      console.error(`select: ${pkg.name}@${pkg.version} already published — skipped`);
    }
  }

  // Dependency-layer order: every dependency publishes before its dependents.
  const memo = new Map();
  selected.sort((a, b) => {
    const layerA = layerOf(a.name, manifests, memo, new Set());
    const layerB = layerOf(b.name, manifests, memo, new Set());
    if (layerA !== layerB) return layerA - layerB;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  console.error(
    selected.length === 0
      ? "select: zero packages to publish (all workspace versions already on the registry)"
      : `select: ${selected.length} package(s) to publish, in dependency order: ${selected
          .map((pkg) => pkg.name)
          .join(" -> ")}`,
  );
  process.stdout.write(`${JSON.stringify(selected.map(({ name, directory, version }) => ({ name, directory, version })), null, 2)}\n`);
}

main();
