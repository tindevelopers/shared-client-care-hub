#!/usr/bin/env node
/**
 * Secret scanner — Hub Tenancy Authority.
 *
 * Invoked by ci.yml (secret-scan job) and by `pnpm secret-scan`.
 * Walks the working tree (tracked AND untracked files — a planted
 * credential anywhere in the tree must be caught) and flags
 * credential-shaped strings. Exits 1 and names each offending
 * file:line when a finding is present; exits 0 on a clean tree.
 *
 * The only exemptions are obvious synthetic placeholders: a token
 * body made of a single repeated character (e.g. `ghp_xxxx…` in
 * documentation) cannot be real credential material. Everything
 * else — including dummy tokens with varied characters planted by
 * the negative self-proof — is flagged.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  "coverage",
  ".turbo",
  ".factory",
]);

const BINARY_EXT = /\.(png|jpe?g|gif|ico|svg|woff2?|ttf|eot|tgz|zip|gz|mp4|webp|pdf)$/i;

/** True when every character of s is the same (obvious placeholder). */
function isUniformPlaceholder(s) {
  const body = s.replace(/^[a-z_]+_/i, ""); // strip prefix like ghp_
  return body.length > 0 && new Set(body).size === 1;
}

// Each entry: name, regex, and (optionally) which capture carries the token.
const PATTERNS = [
  {
    name: "private key block",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    name: "AWS access key ID",
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: "AWS secret access key assignment",
    re: /\b(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?([A-Za-z0-9/+=]{35,60})\b/,
    token: 1,
  },
  {
    name: "GitHub token",
    re: /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/,
    token: 1,
  },
  {
    name: "GitHub fine-grained PAT",
    re: /\b(github_pat_[A-Za-z0-9_]{20,})\b/,
    token: 1,
  },
  {
    name: "OpenAI/Anthropic-style API key",
    re: /\b(sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,})\b/,
    token: 1,
  },
  {
    name: "Slack token",
    re: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/,
    token: 1,
  },
  {
    name: "credential-bearing database URL",
    re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/"']+:[^\s@/"']+@[^\s"']+/,
  },
  {
    name: "JWT / service-role key material",
    re: /\b(eyJhbGciOi[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,})\b/,
    token: 1,
  },
  {
    name: "Supabase secret key",
    re: /\b(sb_secret_[A-Za-z0-9]{20,})\b/,
    token: 1,
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function isScannable(absPath, relPath) {
  if (BINARY_EXT.test(relPath)) return false;
  try {
    const st = statSync(absPath);
    if (st.size > 5 * 1024 * 1024) return false;
  } catch {
    return false;
  }
  return true;
}

function looksBinary(text) {
  return text.slice(0, 4096).includes("\u0000");
}

const findings = [];
for (const abs of walk(ROOT)) {
  const rel = abs.slice(ROOT.length + 1);
  if (!isScannable(abs, rel)) continue;
  let text;
  try {
    text = readFileSync(abs, "utf-8");
  } catch {
    continue;
  }
  if (looksBinary(text)) continue;
  const lines = text.split("\n");
  for (const [idx, line] of lines.entries()) {
    for (const { name, re, token } of PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      if (token && isUniformPlaceholder(m[token])) continue; // doc placeholder
      findings.push(`${rel}:${idx + 1}: ${name}`);
      break; // one finding per line keeps output readable
    }
  }
}

if (findings.length > 0) {
  console.error(`SECRET SCAN FAILED — ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ${f}`);
  console.error("Remove the credential material; never commit secrets.");
  process.exit(1);
}

console.log("Secret scan clean: no credential-shaped strings found.");
process.exit(0);
