import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        // Published @tindevelopers/* packages ship bundler-style extensionless
        // relative imports inside dist/ (tsc output); inline them so Vite
        // resolves those when tests runtime-load them (same pattern as the
        // konnect consumer's root vitest.config.ts).
        inline: [/@tindevelopers\//],
      },
    },
  },
});
