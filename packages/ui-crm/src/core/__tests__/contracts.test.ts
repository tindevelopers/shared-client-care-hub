import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DENY_ALL_CRM_CAPABILITIES,
  type AudienceSourceExtension,
  type CampaignChannelExtension,
  type CrmNavigation,
  type CrmUiResult,
  type JsonValue,
} from "../../index";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return files.flat().filter((path) => [".ts", ".tsx"].includes(extname(path)));
}

describe("ui-crm public contracts", () => {
  const packageRoot = process.cwd().endsWith("ui-crm")
    ? process.cwd()
    : join(process.cwd(), "packages/ui-crm");

  it("uses a discriminated result contract", () => {
    const success: CrmUiResult<number> = { ok: true, data: 42 };
    const failure: CrmUiResult<number> = {
      ok: false,
      error: { code: "unavailable", message: "Unavailable", retryable: true },
    };

    expect(success).toEqual({ ok: true, data: 42 });
    expect(failure.error.retryable).toBe(true);
  });

  it("denies every capability by default", () => {
    expect(DENY_ALL_CRM_CAPABILITIES).toEqual({
      create: false,
      update: false,
      remove: false,
      import: false,
      bulkActions: false,
    });
  });

  it("keeps navigation host-controlled", () => {
    expectTypeOf<CrmNavigation>().toMatchTypeOf<{
      contact(id: string): void;
      campaign(id: string): void;
    }>();
  });

  it("restricts extension configuration to JSON-compatible values", () => {
    type Config = { provider: string; enabled: boolean; weights: number[] };
    expectTypeOf<Config>().toMatchTypeOf<JsonValue>();
    expectTypeOf<AudienceSourceExtension<Config>>().toBeObject();
    expectTypeOf<CampaignChannelExtension<Config>>().toBeObject();
  });

  it("contains no host, router, server-only, Supabase, or provider runtime imports", async () => {
    const contents = await Promise.all(
      (await sourceFiles(join(packageRoot, "src"))).map((path) => readFile(path, "utf8")),
    );
    const source = contents.join("\n");

    expect(source).not.toMatch(
      /(?:from|import\s*)\s*[(']["'](?:next(?:\/|["'])|server-only|@supabase\/|@unkey\/|telnyx|brevo|resend|@\/)/,
    );
    expect(source).not.toMatch(/https?:\/\//);
  });

  it("publishes exactly the six approved entry points", async () => {
    const manifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };

    expect(Object.keys(manifest.exports)).toEqual([
      ".",
      "./contacts",
      "./lists",
      "./suppression",
      "./campaigns",
      "./testing",
    ]);
  });
});
