import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "list",
  timeout: 45_000,
});
