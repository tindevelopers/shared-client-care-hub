import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Hosted-Supabase integration tests do several HTTP round trips per case.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
