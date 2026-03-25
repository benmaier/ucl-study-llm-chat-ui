import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000, // LLM responses can be slow
  expect: {
    timeout: 60_000,
  },
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --port 3001",
    port: 3001,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
