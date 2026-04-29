import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Fallback E2E lives in a separate spec + config (different server env);
  // exclude it here so `npm run test:e2e` doesn't try to run it against
  // the wrong server.
  testIgnore: /fallback\.spec\.ts$/,
  timeout: 120_000, // LLM responses can be slow
  expect: {
    timeout: 60_000,
  },
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
  },
  webServer: {
    command: "npx next dev --port 3001",
    port: 3001,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
