import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8")) as { version?: string };
const packageVersion = typeof pkg.version === "string" ? pkg.version : "0.0.0";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_PACKAGE_VERSION": JSON.stringify(packageVersion),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
