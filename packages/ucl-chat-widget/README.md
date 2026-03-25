# ucl-chat-widget

Reusable LLM chat widget for Next.js applications. Provides a full-featured chat UI with thread management, conversation persistence, and multi-provider LLM support.

## Features

- 3-column layout: thread list sidebar, chat area, configurable info sidebar
- Streaming responses with tool call rendering (code execution, artifacts)
- Conversation history with disk persistence
- Thread list with inline rename
- Markdown rendering with syntax highlighting
- File attachment support
- Configurable via props (sidebar content, labels, API paths)

## Installation

```bash
npm install ucl-chat-widget
# Peer dependency — install the LLM SDK
npm install ucl-study-llm-chat-api  # from github:benmaier/ucl-study-llm-chat-api
```

## Quick Start

### 1. Page component

```tsx
// app/page.tsx
"use client";
import { ChatWidget } from "ucl-chat-widget/client";

export default function ChatPage() {
  return (
    <ChatWidget
      config={{
        sidebarTitle: "AI Assistant",
        welcomeMessage: "How can I help you today?",
        threadListLabel: "Your conversations",
        apiBasePath: "/api",
        sidebarPanels: [
          {
            title: "Instructions",
            content: <p>Your study instructions here...</p>,
            defaultExpanded: true,
          },
        ],
      }}
    />
  );
}
```

### 2. Shared server config

```ts
// app/api/chat-config.ts
import type { ChatRouteConfig } from "ucl-chat-widget/server";

export const chatConfig: ChatRouteConfig = {
  provider: (process.env.CHAT_PROVIDER as any) || "anthropic",
  conversationsDir: process.env.CONVERSATIONS_DIR || "data/conversations",
  traceDir: process.env.TRACE_DIR,
  debugStreams: !!process.env.DEBUG_STREAMS,
  apiBasePath: "/api",
};
```

### 3. API route wrappers

Create these 5 thin route files:

```ts
// app/api/chat/route.ts
import { createChatHandler } from "ucl-chat-widget/server";
import { chatConfig } from "../chat-config";
export const { POST } = createChatHandler(chatConfig);

// app/api/threads/route.ts
import { createThreadsHandler } from "ucl-chat-widget/server";
import { chatConfig } from "../chat-config";
export const { GET } = createThreadsHandler(chatConfig);

// app/api/threads/[id]/route.ts
import { createThreadHandler } from "ucl-chat-widget/server";
import { chatConfig } from "../../chat-config";
export const { GET, PUT } = createThreadHandler(chatConfig);

// app/api/threads/[id]/messages/route.ts
import { createMessagesHandler } from "ucl-chat-widget/server";
import { chatConfig } from "../../../chat-config";
export const { GET } = createMessagesHandler(chatConfig);

// app/api/threads/[id]/artifacts/[fileId]/route.ts
import { createArtifactsHandler } from "ucl-chat-widget/server";
import { chatConfig } from "../../../../chat-config";
export const { GET } = createArtifactsHandler(chatConfig);
```

### 4. Next.js config

```ts
// next.config.ts
const nextConfig = {
  serverExternalPackages: ["ucl-study-llm-chat-api", "ucl-chat-widget"],
};
export default nextConfig;
```

### 5. Styles

Your `app/globals.css` needs:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* Copy or import the theme variables from ucl-chat-widget/styles/globals.css */

/* Fix Tailwind CSS 4 preflight stripping cursor:pointer */
button, [role="button"], a, summary, select, label[for] {
  cursor: pointer;
}
```

### 6. Environment variables

```env
ANTHROPIC_API_KEY=sk-...     # or OPENAI_API_KEY / GOOGLE_API_KEY
CHAT_PROVIDER=anthropic      # "anthropic" | "openai" | "gemini"
```

API keys are read directly by the SDK from `process.env` — they are NOT passed through the widget config.

## API Reference

### Client Exports (`ucl-chat-widget/client`)

#### `<ChatWidget config={ChatWidgetConfig} />`

The main component. Renders the full chat UI including thread list, chat area, and optional info sidebar.

#### `ChatWidgetConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `sidebarTitle` | `string` | `"AI Assist"` | Left sidebar title |
| `welcomeMessage` | `string` | `"How can I help you today?"` | Empty thread welcome text |
| `threadListLabel` | `string` | `"Your chats"` | Label above thread list |
| `sidebarPanels` | `SidebarPanel[]` | `[]` | Right sidebar panels (empty = hidden) |
| `apiBasePath` | `string` | `"/api"` | API route prefix |

#### `SidebarPanel`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `title` | `string` | — | Panel heading |
| `content` | `ReactNode` | — | Panel body content |
| `defaultExpanded` | `boolean` | `false` | Start expanded |

### Server Exports (`ucl-chat-widget/server`)

#### `createChatHandler(config)` → `{ POST }`
Streams LLM responses via SSE. Handles file uploads, conversation persistence, and tracing.

#### `createThreadsHandler(config)` → `{ GET }`
Lists all conversation threads with auto-generated titles.

#### `createThreadHandler(config)` → `{ GET, PUT }`
Get or rename a single thread's metadata.

#### `createMessagesHandler(config)` → `{ GET }`
Returns conversation history in AI SDK UIMessage format.

#### `createArtifactsHandler(config)` → `{ GET }`
Serves generated files (plots, CSVs, text) with correct MIME types.

#### `ChatRouteConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `provider` | `"anthropic" \| "openai" \| "gemini"` | — | LLM provider (required) |
| `conversationsDir` | `string` | — | Disk storage path (required) |
| `traceDir` | `string` | — | JSONL trace output directory |
| `debugStreams` | `boolean` | `false` | Verbose stream logging |
| `apiBasePath` | `string` | `"/api"` | Must match client config |

## Building

```bash
npm install --legacy-peer-deps
npm run build    # produces dist/ via tsup
npm run dev      # watch mode
```

## Peer Dependencies

- `next` >= 15
- `react` >= 19
- `react-dom` >= 19
- `ucl-study-llm-chat-api` >= 1.0.0
