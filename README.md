# ucl-chat-widget

A reusable LLM chat widget for Next.js applications with multi-provider support (Anthropic, OpenAI, Gemini), conversation persistence, code execution rendering, and a pluggable storage backend.

## Repository Structure

This is an npm workspaces monorepo:

```
/
├── packages/widget/     ← the ucl-chat-widget npm package
│   ├── src/
│   │   ├── client/      ← <ChatWidget>, components, config context
│   │   ├── server/      ← route handler factories, ConversationBackend, SSE stream mapper
│   │   ├── types/       ← ChatWidgetConfig, ChatRouteConfig, ConversationBackend
│   │   ├── styles/      ← CSS variables (--llmchat-* namespaced)
│   │   └── __tests__/   ← 45 vitest unit tests
│   ├── package.json     ← name: "ucl-chat-widget" (v0.2.5)
│   └── tsup.config.ts
├── demo/                ← Next.js reference app + Playwright E2E tests
│   ├── app/             ← thin route wrappers, page.tsx
│   ├── e2e/             ← 7 Playwright tests (provider-specific)
│   └── package.json     ← name: "ucl-chat-demo"
├── docs/                ← detailed documentation
└── package.json         ← workspace root (private)
```

## Quick Start

```bash
# Clone and install
git clone git@github.com:benmaier/ucl-study-llm-chat-ui.git
cd ucl-study-llm-chat-ui
npm install --legacy-peer-deps

# Build the widget
npm run build

# Run the demo app
cd demo
cp .env.local.example .env.local  # add your API keys
npx next dev --port 3001
# Open http://localhost:3001
```

## Installing the Widget in Your App

```bash
# Install from GitHub release tarball (recommended)
npm install https://github.com/benmaier/ucl-study-llm-chat-ui/releases/download/v0.3.0/ucl-chat-widget-0.3.0.tgz

# Install the SDK peer dependency
npm install github:benmaier/ucl-study-llm-chat-api
```

```tsx
// app/page.tsx
"use client";
import { ChatWidget } from "ucl-chat-widget/client";

export default function ChatPage() {
  return (
    <ChatWidget
      config={{
        sidebarTitle: "AI Assistant",
        sidebarPanels: [
          { title: "Instructions", content: <p>...</p>, defaultExpanded: true },
        ],
      }}
    />
  );
}
```

```ts
// app/api/chat/route.ts
import { createChatHandler } from "ucl-chat-widget/server";
export const { POST } = createChatHandler({
  provider: "anthropic",
  conversationsDir: "data/conversations",
});
```

See [docs/installation.md](docs/installation.md) for the full setup guide.

## Documentation

- [Installation](docs/installation.md) - Prerequisites, setup, environment variables
- [Architecture](docs/architecture.md) - Workspace layout, runtime flow, SSE protocol, storage
- [Configuration](docs/configuration.md) - Widget config, route config, CSS variables, ConversationBackend
- [API Reference](docs/api-reference.md) - All exported types, components, and handler factories
- [Demo App](docs/demo-app.md) - Running the demo, E2E tests, route wrappers
- [Known Issues](docs/known-issues.md) - Provider-specific behavior, CSS quirks, Node.js compatibility

## Testing

```bash
# Widget unit tests (45 tests, no API keys needed)
npm test

# E2E tests (needs API keys in demo/.env.local)
cd demo
CHAT_PROVIDER=anthropic npx playwright test
CHAT_PROVIDER=openai npx playwright test
CHAT_PROVIDER=gemini npx playwright test
```

## Releasing

```bash
# Release widget only (bumps version, builds, tests, creates tarball, tags, pushes)
make release VERSION=0.3.1

# Release SDK only
make release-sdk VERSION=1.0.9

# Release both
make release-both WIDGET_VERSION=0.3.1 SDK_VERSION=1.0.9

# Just create a tarball without releasing
make tarball
```

The tarball is automatically attached to the GitHub release. Consumers install with:
```bash
npm install https://github.com/benmaier/ucl-study-llm-chat-ui/releases/download/vX.Y.Z/ucl-chat-widget-X.Y.Z.tgz
```

## Related Repositories

- [ucl-study-llm-chat-api](https://github.com/benmaier/ucl-study-llm-chat-api) - TypeScript SDK for Claude/OpenAI/Gemini with code execution, file handling, and streaming

## License

[Apache 2.0](LICENSE)
