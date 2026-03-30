# Demo App

The `demo/` directory contains a Next.js 16 reference app that demonstrates how to use the `ucl-chat-widget` package. It also hosts the Playwright E2E tests.

## Running Locally

```bash
# From repo root
npm install --legacy-peer-deps
npm run build  # build the widget first

# Setup env vars
cd demo
cp .env.local.example .env.local
# Edit .env.local with your API keys

# Start the dev server
npx next dev --port 3001
# Open http://localhost:3001
```

Note: On Node.js v24, `npx next` works. On some versions, you may need `node node_modules/next/dist/bin/next dev`.

## Route Wrappers

The demo app has 5 thin route files that delegate to the widget's handler factories:

```
demo/app/api/
├── chat-config.ts                              ← shared ChatRouteConfig
├── chat/route.ts                               ← createChatHandler(chatConfig)
├── threads/route.ts                            ← createThreadsHandler(chatConfig)
└── threads/[id]/
    ├── route.ts                                ← createThreadHandler(chatConfig)
    ├── messages/route.ts                       ← createMessagesHandler(chatConfig)
    └── artifacts/[fileId]/route.ts             ← createArtifactsHandler(chatConfig)
```

Each route file is 3-4 lines. All configuration is centralized in `chat-config.ts`.

## Study-Specific Content

The demo's `page.tsx` configures the right sidebar with UCL study content:

- **Scenario** (default expanded): Study description and instructions
- **Data description**: Information about the dataset
- **Tasks**: What the participant should do

This content is passed as React nodes via `sidebarPanels`, not hardcoded in the widget.

## E2E Tests

The demo includes 7 Playwright E2E tests that verify the full streaming experience across all 3 providers.

### Running Tests

```bash
cd demo

# All tests with a specific provider
CHAT_PROVIDER=anthropic npx playwright test
CHAT_PROVIDER=openai npx playwright test
CHAT_PROVIDER=gemini npx playwright test

# Watch in browser
CHAT_PROVIDER=anthropic npx playwright test --headed

# Run a specific test
npx playwright test -g "tool call renders"
```

### Test List

| Test | What it verifies |
|------|-----------------|
| Page loads with sidebar and composer | Thread list, composer input, right sidebar panels visible |
| Send simple text message | Message streams, assistant response appears |
| Tool call renders with status and result | Tool card shows "Used tool", expandable code + result |
| Multiple tool calls in order with results | Both cards visible, both have results, correct DOM order |
| Tool 1 completes before tool 2 starts (anthropic/gemini) | First tool's spinner stops before second appears |
| Both tools complete after stream ends (openai) | Both tools stay running until stream ends, then complete |
| Thread list updates after sending | New thread appears in sidebar |

### Provider-Specific Behavior

The tool lifecycle test uses `test.skip()` to assert different behavior per provider:

- **Anthropic/Gemini**: Tool 1 completes with result visible BEFORE tool 2's card appears (inline `code_output`)
- **OpenAI**: Both tools stay "running" until the entire stream ends, then both complete at once (deferred `code_output`)

This is an OpenAI API limitation — see [Known Issues](known-issues.md).

### Playwright Configuration

```ts
// demo/playwright.config.ts
{
  testDir: "./e2e",
  timeout: 120_000,        // LLM responses can be slow
  expect: { timeout: 60_000 },
  use: { baseURL: "http://localhost:3001" },
  webServer: {
    command: "npx next dev --port 3001",
    port: 3001,
    reuseExistingServer: true,
  },
}
```

The `webServer` config auto-starts the demo app before tests run.
