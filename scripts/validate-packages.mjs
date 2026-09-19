#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = resolve(root, "packages");
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
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log("Package exports and MIT metadata are valid.");
}
