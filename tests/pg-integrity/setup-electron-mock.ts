import { vi } from "vitest";
import path from "path";
import os from "os";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) =>
      name === "userData" ? path.join(os.tmpdir(), "teamlog-pg-integration-test-userdata") : process.cwd(),
    getAppPath: () => process.cwd(),
  },
}));
