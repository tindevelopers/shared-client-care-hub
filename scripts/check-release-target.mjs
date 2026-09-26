#!/usr/bin/env node
/**
 * Release-target sentinel — Hub Tenancy Authority (rulings P3-4 §9, P3-5,
 * P3-10 §5; VAL-REL-035/036/037).
 *
 * The committed release-targets.json pins {package, intended version,
 * milestone} for every planned mission publish. This script is leg 1 of the
 * six-leg milestone gate and runs IMMEDIATELY BEFORE EVERY PUBLISH. It is
 * strictly READ-ONLY: the only registry command it ever issues is
 * `npm view <pkg> versions dist-tags time --json`.
 *
 * It FAILS CLOSED when any of the following holds:
 *   (1) a pinned target is no longer free (already on the registry);
 *   (2) a pinned target is neither one correct semver step from the
 *       workspace version (the PLANNING state) nor exactly equal to the
 *       workspace version while still unpublished (the READY-TO-PUBLISH
 *       state `release.yml` occupies after `changeset version`, immediately
 *       before `npm publish`) — ruling P3-11;
 *   (3) `latest` or `next` has moved past a pinned target;
 *   (4) the registry version list or dist-tags differ from the committed
 *       snapshot in any unexplained way — a new out-of-band version, a
 *       changed publish time, or a dist-tag move not made by a pinned
 *       publish is unexplained and fails;
 *   (5) the domain-support hazard (ruling P3-10 §5): the registry is AHEAD
 *       of its workspace (latest 2.0.0 vs 1.0.0, recorded as KNOWN drift —
 *       the record alone never fails), but ANY domain-support family pin
 *       fails while the drift record marks the family target unauthorized,
 *       and a pin at or below the registry high-water mark always fails.
 *
 * ON FAILURE: STOP AND RETURN TO THE ORCHESTRATOR. Do not pick a different
 * version, do not retry with a bump, do not move a dist-tag, and do not edit
 * release-targets.json to make the check pass. A WORKER NEVER INVENTS OR
 * ADJUSTS A VERSION NUMBER — out-of-band publishes are EXPECTED, and
 * re-pinning is the orchestrator's job with the user (P3-10 §6).
 *
 * Negative self-proofs for every condition live in
 * tests/check-release-target.test.ts — a sentinel never shown to fail
 * proves nothing.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { compareVersions, parseSemver } from "./promote.mjs";

/** The ONLY registry command this script is ever allowed to build. */
export function npmViewArgs(pkg) {
  // Qualify with a version range (rather than a bare package name, which npm
  // resolves against the "latest" dist-tag) so a package published only
  // under a non-latest tag (e.g. freshly shipped to "next", not yet
  // promoted) still resolves. Without this, npm silently exits 0 with empty
  // stdout when "latest" doesn't exist, which JSON.parse then treats as a
  // registry-unreachable failure below.
  return ["view", `${pkg}@>=0.0.0`, "versions", "dist-tags", "time", "--json"];
}

/** Computes the version a `<bump>` changeset yields from `version`. */
export function incVersion(version, bump) {
  const parsed = parseSemver(version);
  if (!parsed || parsed.prerelease.length > 0) {
    throw new Error(`incVersion: not a release version ("${version}")`);
  }
  if (bump === "patch") return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  if (bump === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  if (bump === "major") return `${parsed.major + 1}.0.0`;
  throw new Error(`incVersion: unknown bump "${bump}" (patch|minor|major)`);
}

/** Default read-only registry reader via npm view. Returns null on failure. */
export function npmView(pkg) {
  const run = spawnSync("npm", npmViewArgs(pkg), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  if (run.error) return null;
  if (run.status !== 0) {
    // E404 means the package was never published — a valid PLANNING state,
    // not a registry-unreachable failure (mirrors select-publishable-packages.mjs).
    // Any other non-zero exit (network error, auth error, etc.) still fails closed.
    if (String(run.stderr ?? "").includes("E404")) {
      return { versions: [], distTags: {}, time: {} };
    }
    return null;
  }
  try {
    const json = JSON.parse(run.stdout);
    // The @>=0.0.0 range above resolves to exactly one version's merged doc
    // (a plain object) when the package has only one version, but to an
    // array of one doc per matched version when it has several — every
    // entry carries the same packument-level versions/dist-tags/time, so
    // the first is enough. A real doc is never itself an array.
    const doc = Array.isArray(json) ? json[0] : json;
    return {
      versions: doc?.versions ?? [],
      distTags: doc?.["dist-tags"] ?? {},
      time: doc?.time ?? {},
    };
  } catch {
    return null;
  }
}

/** Default workspace-version reader: packages/<dir>/package.json by name. */
export function workspaceVersionFromRepo(repoRoot) {
  return (pkg) => {
    try {
      const manifest = JSON.parse(
        readFileSync(join(repoRoot, "packages", pkg.replace(/^@tindevelopers\//, ""), "package.json"), "utf8"),
      );
      return manifest.name === pkg ? (manifest.version ?? null) : null;
    } catch {
      return null;
    }
  };
}

const CONDITION = {
  CONFIG: "config-invalid",
  NEVER_PUBLISH: "never-publish",
  UNREACHABLE: "registry-unreachable",
  COND1: "condition-1-target-not-free",
  COND2: "condition-2-wrong-semver-step",
  COND3: "condition-3-tag-moved-past-target",
  COND4: "condition-4-unexplained-divergence",
  HAZARD: "hazard-domain-support",
};

/**
 * Pure check core — unit-tested against the committed snapshot in
 * tests/check-release-target.test.ts. `deps` carries the two injectable
 * effects so the negative self-proofs never touch the live registry.
 */
export function checkReleaseTargets(config, deps) {
  const failures = [];
  const add = (pkg, condition, message) =>
    failures.push({ package: pkg, condition, message });

  // ---- configuration self-validation --------------------------------------
  const pins = Array.isArray(config.pins) ? config.pins : [];
  const neverPublish = Array.isArray(config.neverPublish) ? config.neverPublish : [];
  if (pins.length === 0 && config.governance?.pinsLifecycleClosed !== true) {
    add("(config)", CONDITION.CONFIG, "release-targets.json pins no targets — every planned publish must be pinned (VAL-REL-035)");
  }
  // End-of-mission state (final gate, 2026-09-20): every planned pin is
  // either consumed (P3-12 retirements) or cancelled by a recorded
  // disposition (the conditional ui-shell@1.1.0 pin, PKG-6 determination
  // UNCHANGED / not published), and release-targets.json records
  // governance.pinsLifecycleClosed === true to say so explicitly. An EMPTY
  // pins array is green ONLY in that recorded state; without the record the
  // config-invalid failure above still fires. This is NOT a weakening: every
  // registry condition (1-4), the domain-support hazard and the
  // never-publish list still run unchanged over the snapshot, the drift
  // record and any future pin.
  for (const pin of pins) {
    if (!pin.package || !pin.version || !pin.milestone) {
      add(pin.package ?? "(config)", CONDITION.CONFIG,
        "every pin needs {package, version, milestone}");
    }
    if (!["patch", "minor", "major"].includes(pin.bump)) {
      add(pin.package, CONDITION.CONFIG, `pin ${pin.version} has invalid bump "${pin.bump}"`);
    }
    if (!parseSemver(pin.version)) {
      add(pin.package, CONDITION.CONFIG, `pin "${pin.version}" is not valid semver`);
    }
    const banned = neverPublish.find((n) => n.package === pin.package && n.version === pin.version);
    if (banned) {
      add(pin.package, CONDITION.NEVER_PUBLISH,
        `pin ${pin.version} is on the never-publish list (${banned.reason})`);
    }
  }

  const pinsByPackage = new Map();
  for (const pin of pins) {
    if (!pin.package || !parseSemver(pin.version)) continue;
    if (!pinsByPackage.has(pin.package)) pinsByPackage.set(pin.package, []);
    pinsByPackage.get(pin.package).push(pin);
  }
  for (const [pkg, pinned] of pinsByPackage) {
    const sorted = [...pinned].sort((a, b) => compareVersions(a.version, b.version));
    for (let i = 1; i < sorted.length; i += 1) {
      if (compareVersions(sorted[i - 1].version, sorted[i].version) >= 0) {
        add(pkg, CONDITION.CONFIG,
          `pinned targets must be strictly increasing (${sorted[i - 1].version} vs ${sorted[i].version})`);
      }
    }
    pinsByPackage.set(pkg, sorted);
  }

  // ---- per-package checks against the live registry -----------------------
  const snapshotPackages = { ...(config.snapshot?.packages ?? {}) };
  const packages = new Set([
    ...Object.keys(snapshotPackages),
    ...pinsByPackage.keys(),
    ...(config.knownDrift ?? []).map((d) => d.package),
  ]);

  for (const pkg of packages) {
    const snap = snapshotPackages[pkg];
    const snapVersions = snap?.versions ?? [];
    const snapTags = snap?.distTags ?? {};
    const snapTimes = snap?.publishTimes ?? {};
    const pinned = pinsByPackage.get(pkg) ?? [];
    const pinVersions = new Set(pinned.map((p) => p.version));

    const live = deps.fetchRegistry(pkg);
    if (!live) {
      add(pkg, CONDITION.UNREACHABLE,
        "registry query failed (npm view) — failing closed");
      continue;
    }

    // Condition 4 — unexplained divergence of the version list.
    for (const version of live.versions) {
      if (!snapVersions.includes(version) && !pinVersions.has(version)) {
        add(pkg, CONDITION.COND4,
          `registry version ${version} is neither in the committed snapshot nor a pinned target — ` +
          `unexplained divergence (an out-of-band publish is EXPECTED; STOP and return so the orchestrator re-pins)`);
      }
    }
    for (const version of snapVersions) {
      if (!live.versions.includes(version)) {
        add(pkg, CONDITION.COND4,
          `snapshot version ${version} is missing from the registry — unexplained divergence`);
      }
    }
    for (const version of snapVersions) {
      if (snapTimes[version] && live.time[version] && snapTimes[version] !== live.time[version]) {
        add(pkg, CONDITION.COND4,
          `publish time of ${version} changed (${snapTimes[version]} -> ${live.time[version]}) — unexplained divergence`);
      }
    }

    // Condition 4 — unexplained divergence of dist-tags. A tag may only
    // point where the snapshot recorded, or at a pinned target (a move made
    // by one of our own publishes); anything else is unexplained.
    for (const [tag, value] of Object.entries(live.distTags)) {
      if (!(tag in snapTags)) {
        if (!pinVersions.has(value)) {
          add(pkg, CONDITION.COND4,
            `dist-tag "${tag}" appeared pointing at ${value} — unexplained divergence`);
        }
        continue;
      }
      if (value !== snapTags[tag] && !pinVersions.has(value)) {
        add(pkg, CONDITION.COND4,
          `dist-tag "${tag}" moved to ${value} (snapshot: ${snapTags[tag]}) — not a pinned target, unexplained divergence`);
      }
      if (!live.versions.includes(value)) {
        add(pkg, CONDITION.COND4,
          `dist-tag "${tag}" points at ${value}, which is not on the registry — unexplained divergence`);
      }
    }
    for (const tag of Object.keys(snapTags)) {
      if (!(tag in live.distTags)) {
        add(pkg, CONDITION.COND4,
          `dist-tag "${tag}" (snapshot: ${snapTags[tag]}) disappeared — unexplained divergence`);
      }
    }

    // Condition 1 — every pinned target must still be free.
    for (const pin of pinned) {
      if (live.versions.includes(pin.version)) {
        add(pkg, CONDITION.COND1,
          `pinned target ${pkg}@${pin.version} (${pin.milestone}) is no longer free — it is already on the registry`);
      }
    }

    // Condition 2 — GREEN in exactly TWO states (ruling P3-11), fail closed
    // in all others:
    //   PLANNING (unchanged): the next unpublished pin is the exact semver
    //   step from the CURRENT workspace version, so a `<bump>` changeset
    //   computes the pinned version. (Unreconciled workspace 1.1.0 would
    //   compute the consumed 1.1.1 — exactly this failure. Ruling P3-10 §2.)
    //   READY-TO-PUBLISH (NEW): the workspace version EQUALS the next
    //   unpublished pin — precisely the state the release.yml sentinel step
    //   occupies after `changeset version` and before `npm publish`. A
    //   workspace ABOVE the pin (bumped past an unpublished target) or below
    //   it with the wrong step still fails closed. A workspace AT the pin
    //   whose version is already published is a republish attempt, caught by
    //   condition 1 (it never reaches this branch — the pin is not
    //   "unpublished").
    const unpublished = pinned.filter((p) => !live.versions.includes(p.version));
    if (unpublished.length > 0) {
      const nextPin = unpublished[0];
      const workspace = deps.workspaceVersion(pkg);
      if (workspace === null || workspace === undefined) {
        add(pkg, CONDITION.COND2,
          `workspace version unreadable for ${pkg} — cannot verify the semver step to ${nextPin.version}`);
      } else if (!parseSemver(workspace)) {
        add(pkg, CONDITION.COND2,
          `workspace version "${workspace}" is not valid semver — cannot verify the step to ${nextPin.version}`);
      } else if (workspace !== nextPin.version) {
        let expected = null;
        try {
          expected = incVersion(workspace, nextPin.bump);
        } catch {
          // invalid workspace shape — leave expected null; the failure below reports it
        }
        if (expected !== nextPin.version) {
          add(pkg, CONDITION.COND2,
            `pinned target ${nextPin.version} is not the correct ${nextPin.bump} step from the workspace ` +
            `version ${workspace}${expected === null ? "" : ` (a ${nextPin.bump} changeset computes ${expected})`}`);
        }
      }
    }

    // Condition 3 — latest/next must not have moved past any unpublished pin.
    for (const pin of unpublished) {
      for (const tag of ["latest", "next"]) {
        const at = live.distTags[tag];
        if (at !== undefined && parseSemver(at) && compareVersions(at, pin.version) > 0) {
          add(pkg, CONDITION.COND3,
            `dist-tag "${tag}" (${at}) has moved past the pinned target ${pin.version}`);
        }
      }
    }

    // Fifth scenario — the domain-support hazard (ruling P3-10 §5). The
    // recorded drift is KNOWN and never fails by itself; the specific hazard
    // (a family publish at or below the registry high-water mark, any state
    // implying latest moving backwards, or an unauthorized family target)
    // always fails closed.
    const drift = (config.knownDrift ?? []).find((d) => d.package === pkg);
    if (drift) {
      const liveLatest = live.distTags.latest;
      for (const pin of pinned) {
        if (
          liveLatest !== undefined &&
          parseSemver(liveLatest) &&
          compareVersions(pin.version, liveLatest) <= 0
        ) {
          add(pkg, CONDITION.HAZARD,
            `family target ${pin.version} is at or below the registry high-water mark ${liveLatest} — ` +
            `never publish ${pkg} at or below ${liveLatest} and never move its latest backwards (ruling P3-10 §5)`);
        }
        if (drift.familyTargetAuthorized === false) {
          add(pkg, CONDITION.HAZARD,
            `a family pin for ${pkg} (${pin.version}) exists while the drift record marks the family target NOT authorized ` +
            `(ruling P3-10 §5) — the family version is computed from the registry high-water mark by the ` +
            `orchestrator, never by a worker; STOP AND RETURN`);
        }
      }
      if (
        liveLatest !== undefined &&
        drift.registryLatest !== undefined &&
        parseSemver(liveLatest) &&
        compareVersions(liveLatest, drift.registryLatest) < 0
      ) {
        add(pkg, CONDITION.HAZARD,
          `dist-tag "latest" moved backwards (${drift.registryLatest} -> ${liveLatest}) — never move ${pkg} latest backwards`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

function main() {
  const repoRoot = dirname(dirname(pathToFileURL(process.argv[1]).pathname));
  let config;
  try {
    config = JSON.parse(readFileSync(join(repoRoot, "release-targets.json"), "utf8"));
  } catch (error) {
    console.error(`check-release-target: FAIL — cannot read release-targets.json: ${error.message}`);
    process.exit(1);
  }

  const result = checkReleaseTargets(config, {
    fetchRegistry: npmView,
    workspaceVersion: workspaceVersionFromRepo(repoRoot),
  });

  const pinCount = (config.pins ?? []).length;
  if (result.ok) {
    console.log(
      `check-release-target: OK — ${pinCount} pinned target(s) still free and correctly stepped, ` +
      `registry matches the committed snapshot, domain-support KNOWN drift accounted for (read-only npm view)`,
    );
    return;
  }
  console.error(`check-release-target: FAIL — ${result.failures.length} condition(s):`);
  for (const failure of result.failures) {
    console.error(`check-release-target:   [${failure.condition}] ${failure.package}: ${failure.message}`);
  }
  console.error(
    "check-release-target: STOP and return to the orchestrator — do not pick a different version, " +
    "retry with a bump, move a dist-tag, or edit release-targets.json to make this check pass. " +
    "Out-of-band publishes are expected; re-pinning is the orchestrator's job (rulings P3-4 §9, P3-10 §6).",
  );
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}
