import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/pg-integrity/setup-electron-mock.ts"],
    include: ["tests/pg-integrity/**/*.integration.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
