import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  reporter: [
    ["list"],
    ["json", { outputFile: "docs/evidence/playwright-results.json" }],
  ],
});
