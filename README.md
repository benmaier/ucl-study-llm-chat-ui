# UCL Study LLM Chat Frontend

Next.js 16 chat application for the UCL research study. Uses the [`ucl-chat-widget`](./packages/ucl-chat-widget/) package for the chat UI and [`ucl-study-llm-chat-api`](https://github.com/benmaier/ucl-study-llm-chat-api) SDK for LLM provider access (Anthropic, OpenAI, Gemini).

## Architecture

This repo is a thin consuming app that imports the reusable `ucl-chat-widget` package:

```
app/
  page.tsx              → renders <ChatWidget config={...} />
  layout.tsx            → fonts, dark mode, global styles
  globals.css           → Tailwind theme + CSS variables
  api/
    chat-config.ts      → shared ChatRouteConfig (provider, storage dir)
    chat/route.ts       → createChatHandler(config) — streams LLM responses
    threads/route.ts    → createThreadsHandler(config) — lists threads
    threads/[id]/...    → thread metadata, messages, artifacts routes
packages/
  ucl-chat-widget/      → reusable chat widget package (see its own README)
```

### How it works

- **`app/page.tsx`** renders `<ChatWidget>` with study-specific sidebar content (scenario, data description, tasks)
- **`app/api/chat-config.ts`** reads env vars and creates a `ChatRouteConfig` object
- **Route files** are 3-line wrappers that call the widget's handler factories with the shared config
- **API keys** are read by the SDK directly from `process.env` (not passed through config)

## Setup

```bash
# Install dependencies
npm install

# Build the widget package (required after changes to packages/ucl-chat-widget/)
cd packages/ucl-chat-widget && npm install --legacy-peer-deps && npm run build && cd ../..

# Create .env.local with your API keys
cp .env.local.example .env.local
# Edit .env.local with your keys
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes (if using Anthropic) | — | Claude API key |
| `OPENAI_API_KEY` | Yes (if using OpenAI) | — | OpenAI API key |
| `GOOGLE_API_KEY` | Yes (if using Gemini) | — | Gemini API key |
| `CHAT_PROVIDER` | No | `"anthropic"` | LLM provider: `"anthropic"`, `"openai"`, or `"gemini"` |
| `CONVERSATIONS_DIR` | No | `"data/conversations"` | Directory for conversation persistence |
| `TRACE_DIR` | No | — | When set, writes JSONL trace files for debugging |
| `DEBUG_STREAMS` | No | — | When `"1"`, enables verbose streaming event logs |

## Development

```bash
# Node.js v24 on this machine — use node directly instead of npx next
node node_modules/next/dist/bin/next dev

# Run tests
npx vitest run
```

## Rebuilding the Widget Package

After making changes to `packages/ucl-chat-widget/`:

```bash
cd packages/ucl-chat-widget
npm run build
cd ../..
# The consuming app picks up changes automatically (linked via file: dependency)
```

## Related Repositories

- [`ucl-study-llm-chat-api`](https://github.com/benmaier/ucl-study-llm-chat-api) — TypeScript SDK for Claude/OpenAI/Gemini with code execution, file handling, and streaming
