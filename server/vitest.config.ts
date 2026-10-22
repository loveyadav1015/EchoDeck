import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
