import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";
import { componentTagger } from "lovable-tagger";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8")) as { version?: string };
const packageVersion = typeof pkg.version === "string" ? pkg.version : "0.0.0";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'electron' ? './' : '/',
  define: {
    "import.meta.env.VITE_APP_PACKAGE_VERSION": JSON.stringify(packageVersion),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
