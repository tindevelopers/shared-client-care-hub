import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Package-local mirror of the hub root vitest.config.ts so `vitest run` from
// inside the package (pnpm --filter … test, the validation-contract entry
// point) behaves identically to the root run: the server-only mock is
// installed and published @tindevelopers/* dist bundles are inlined so their
// extensionless relative imports resolve. Paths are anchored to this config
// file so they hold regardless of the invoking cwd.
const hubRootSetup = fileURLToPath(new URL("../../vitest.setup.ts", import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: [hubRootSetup],
    server: {
      deps: {
        inline: [/@tindevelopers\//],
      },
    },
  },
});
