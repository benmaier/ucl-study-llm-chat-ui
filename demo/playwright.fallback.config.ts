/**
 * Playwright config for the fallback E2E suite.
 *
 * The server is started with an intentionally-broken primary
 * (`CHAT_MODEL=gemini-3-flash`, an invalid Gemini model id) and OpenAI
 * configured as fallback. The widget should silently fall back on every
 * turn so the user never sees an error banner.
 *
 * Requires both GOOGLE_API_KEY (or GEMINI_API_KEY) and OPENAI_API_KEY.
 *
 * Run:
 *   npm run test:e2e:fallback
 */

import { defineConfig } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

// Load .env.local manually — Next.js loads it for the dev server, but
// Playwright runs in its own Node context and the test-level
// `process.env.OPENAI_API_KEY` checks need it surfaced too (otherwise the
// `test.skip(!HAS_KEYS)` guard fires and the suite silently no-ops).
try {
  const envFile = readFileSync(join(__dirname, ".env.local"), "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
} catch { /* file optional */ }

export default defineConfig({
  testDir: "./e2e",
  testMatch: /fallback\.spec\.ts$/,
  timeout: 180_000, // fallback flow involves a primary failure + retry, so allow extra time
  expect: {
    timeout: 90_000,
  },
  use: {
    baseURL: "http://localhost:3002",
    headless: true,
  },
  webServer: {
    // Pinned env: primary is broken (gemini-3-flash doesn't exist), openai
    // is the fallback. Port 3002 to avoid clashing with the streaming suite.
    command:
      "CHAT_PROVIDER=gemini CHAT_MODEL=gemini-3-flash CHAT_FALLBACK_PROVIDER=openai " +
      "CONVERSATIONS_DIR=data/conversations-fallback-e2e npx next dev --port 3002",
    port: 3002,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
