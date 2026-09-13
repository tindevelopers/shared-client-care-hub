#!/usr/bin/env node
/**
 * Thin wrapper around the dependency-cruiser CLI that restores non-zero exit
 * codes for machine output types. depcruise deliberately exits 0 for
 * `--output-type json` (and other machine formats) even when the report
 * contains error-severity violations, which breaks command-line gating:
 *
 *   pnpm depcruise --config .dependency-cruiser.cjs --output-type json packages
 *
 * would exit 0 on a violating tree. This wrapper forwards every argument
 * verbatim to the real CLI, streams stdout/stderr through unchanged, and:
 *   - exits with the CLI's own code when it is non-zero, and
 *   - for `--output-type json` runs only, re-exits 1 when the emitted report
 *     carries error-severity violations (matching the default reporter's
 *     exit behavior, which the `test` script relies on).
 *
 * Registered as the root `depcruise` npm script; `node_modules/.bin/depcruise`
 * (used by the `test` script and `pnpm exec`) is untouched.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const realCli = join(here, "..", "node_modules", ".bin", "depcruise");
const args = process.argv.slice(2);

function outputType(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--output-type" || arg === "-T") return argv[i + 1];
    if (arg?.startsWith("--output-type=")) return arg.slice("--output-type=".length);
  }
  return undefined;
}

const child = spawn(realCli, args, { stdio: ["inherit", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

child.on("error", (error) => {
  process.stderr.write(`depcruise wrapper: failed to launch ${realCli}\n${error}\n`);
  process.exit(1);
});

child.on("close", (code) => {
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  if (code !== 0 && code !== null) process.exit(code);
  if (code === null) process.exit(1);
  if (outputType(args) === "json") {
    // pnpm may prepend engine warnings to stdout; the JSON body starts at the
    // first line-leading "{" (same dance tests/boundary/rules-fire.test.ts does).
    const start = stdout.search(/^\{/m);
    if (start >= 0) {
      try {
        const report = JSON.parse(stdout.slice(start));
        const hasErrors = (report.summary?.violations ?? []).some(
          (violation) => violation?.rule?.severity === "error",
        );
        if (hasErrors) process.exit(1);
      } catch (error) {
        process.stderr.write(
          `depcruise wrapper: could not parse json report; keeping exit 0 (${error})\n`,
        );
      }
    }
  }
  process.exit(0);
});
