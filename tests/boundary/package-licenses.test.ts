import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const packages = ["schema-crm", "schema-support", "domain-contacts", "domain-campaigns", "ui-crm"];

describe("CRM package licenses", () => {
  for (const name of packages) {
    it(`${name} declares and ships MIT`, async () => {
      const root = new URL(`../../packages/${name}/`, import.meta.url);
      const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
      expect(manifest.license).toBe("MIT");
      expect(manifest.files).toContain("LICENSE");
      expect(await readFile(new URL("LICENSE", root), "utf8")).toContain("MIT License");
    });
  }
});
