#!/usr/bin/env node
/**
 * Read-only hosted validation (VAL-SCHEMA-002): fetch one real `contacts` row
 * from hosted Supabase via PostgREST and parse it with the built schema-crm
 * contacts row schema.
 *
 * Prints pass/fail and Zod issue paths only — never the key, never row data.
 * Loads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the hub root `.env`
 * (values originate in the consumer repo's `.env.local`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../.env");

try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // no .env — fall through to explicit env vars
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("HOSTED ROW PARSE: FAIL (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set)");
  process.exit(1);
}

let schemaMod;
try {
  ({ contactRowSchema: schemaMod } = await import("../packages/schema-crm/dist/index.js"));
} catch (err) {
  console.error(
    `HOSTED ROW PARSE: FAIL (cannot import packages/schema-crm/dist — run pnpm build first; ${err.code ?? err.message})`,
  );
  process.exit(1);
}

const res = await fetch(`${url}/rest/v1/contacts?select=*&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error(`HOSTED ROW PARSE: FAIL (PostgREST HTTP ${res.status})`);
  process.exit(1);
}
const rows = await res.json();
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("HOSTED ROW PARSE: FAIL (no rows returned)");
  process.exit(1);
}

const row = rows[0];
const result = schemaMod.safeParse(row);
if (!result.success) {
  console.error("HOSTED ROW PARSE: FAIL (schema/DB drift — Zod issues):");
  for (const issue of result.error.issues) {
    console.error(`  issue at '${issue.path.join(".")}' [${issue.code}]: ${issue.message}`);
  }
  process.exit(1);
}

const schemaColumns = Object.keys(schemaMod.shape).sort();
const absent = schemaColumns.filter((c) => !(c in row));
console.log(`HOSTED ROW PARSE: PASS (${schemaColumns.length} columns validated)`);
console.log(
  `hosted row carried ${Object.keys(row).length} column(s)` +
    (absent.length
      ? `; DDL columns not present on hosted DB (accepted as optional): ${absent.join(", ")}`
      : "; full column set present"),
);
