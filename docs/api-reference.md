# API Reference

## Client Exports (`ucl-chat-widget/client`)

### `<ChatWidget config={ChatWidgetConfig} />`

The main entry point. Renders the full 3-column chat UI including thread list sidebar, streaming chat area, and configurable info sidebar.

Includes its own `TooltipProvider` — the parent layout does not need one.

```tsx
import { ChatWidget } from "ucl-chat-widget/client";

<ChatWidget
  config={{
    sidebarTitle: "AI Assistant",
    welcomeMessage: "How can I help?",
    threadListLabel: "Your conversations",
    apiBasePath: "/api",
    sidebarPanels: [
      { title: "Info", content: <p>...</p>, defaultExpanded: true },
    ],
  }}
/>
```

### `ChatWidgetConfigProvider`

React context provider for `ChatWidgetConfig`. Used internally by `ChatWidget`, but can be used directly for custom layouts.

### `useChatWidgetConfig()`

Hook that returns the current `Required<ChatWidgetConfig>` from context. All fields have defaults filled in.

---

## Server Exports (`ucl-chat-widget/server`)

### Handler Factories

All handlers accept `ChatRouteConfig` and return Next.js route handler objects.

#### `createChatHandler(config)` → `{ POST }`

Streams LLM responses via SSE. Extracts the latest user message, uploads attached files, calls `conversation.send()`, and maps SDK events to the assistant-ui v1 SSE protocol.

**Request body**: AI SDK `UIMessage[]` format with `id` (thread ID) and `messages` array.

**Response**: `text/event-stream` with header `x-vercel-ai-ui-message-stream: v1`.

Also exports helper functions:
- `extractText(msg: UIMessage | undefined): string`
- `extractFiles(msg: UIMessage | undefined): Array<{ url, mediaType, filename }>`
- `dataUrlToBuffer(dataUrl: string): Buffer`

#### `createThreadsHandler(config)` → `{ GET }`

Returns `{ threads: ThreadMeta[] }` — all conversations sorted newest first with auto-generated titles.

#### `createThreadHandler(config)` → `{ GET, PUT }`

- **GET**: Returns `ThreadMeta` for a single thread (404 if not found).
- **PUT**: Updates thread title. Body: `{ title: string }`.

#### `createMessagesHandler(config)` → `{ GET }`

Returns `{ messages: UIMessageOut[] }` — conversation history in AI SDK UIMessage format. Converts stored turns via the SDK's `convertTurnsToMessages()`, then maps to text, tool-call, and file UI parts.

Generated files are written to the artifacts directory and returned as markdown image/link URLs.

#### `createArtifactsHandler(config)` → `{ GET }`

Serves generated files (PNG, JPEG, SVG, PDF, CSV, TXT) with correct MIME types. Files are served from `{conversationsDir}/{threadId}/artifacts/`. Cache-Control: 1 hour.

Thread ID and file ID are sanitized to prevent path traversal.

### `FileConversationBackend`

Default filesystem-backed implementation of `ConversationBackend`. Singleton per `conversationsDir`.

```ts
import { FileConversationBackend } from "ucl-chat-widget/server";

const backend = FileConversationBackend.getInstance({
  provider: "anthropic",
  conversationsDir: "data/conversations",
});
```

Methods:
- `getOrCreateConversation(threadId)` — Cache hit, disk resume, or new
- `listThreads()` — Scan directories, auto-title, sort newest first
- `getThreadMeta(threadId)` — Single thread metadata
- `updateThreadTitle(threadId, title)` — Write to conversation.json metadata
- `getConversationData(threadId)` — Raw turns + uploads for history loading
- `artifactsDirForThread(threadId)` — Path to artifacts directory
- `filePathForThread(threadId)` — Path to conversation.json

### `ConversationStore`

Alias for `FileConversationBackend` (backward compatibility).

### `resolveBackend(config)`

Returns `config.backend` if provided, otherwise creates a `FileConversationBackend` from `config.provider` + `config.conversationsDir`. Throws if neither is available.

---

## Types

### `ChatWidgetConfig`

Client-side widget configuration (safe for browser).

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `sidebarTitle` | `string` | `"AI Assist"` | Left sidebar heading |
| `welcomeMessage` | `string` | `"How can I help you today?"` | Empty thread welcome text |
| `threadListLabel` | `string` | `"Your chats"` | Label above thread list |
| `sidebarPanels` | `SidebarPanel[]` | `[]` | Right sidebar panels (empty = no sidebar) |
| `apiBasePath` | `string` | `"/api"` | API route prefix |

### `SidebarPanel`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `title` | `string` | — | Panel heading |
| `content` | `ReactNode` | — | Panel body |
| `defaultExpanded` | `boolean` | `false` | Start expanded |

### `ChatRouteConfig`

Server-side configuration for route handler factories.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `backend` | `ConversationBackend` | — | Custom backend (overrides provider + dir) |
| `provider` | `"anthropic" \| "openai" \| "gemini"` | — | Required if no backend |
| `conversationsDir` | `string` | — | Required if no backend |
| `extraWriters` | `ConversationWriter[]` | `[]` | Additional writers alongside FileWriter |
| `traceDir` | `string` | — | JSONL trace output directory |
| `debugStreams` | `boolean` | `false` | Verbose streaming event logs |
| `apiBasePath` | `string` | `"/api"` | Must match client config |
| `apiKey` | `string` | — | API key (recommended for serverless) |

### `ConversationBackend`

Interface for pluggable conversation storage.

```typescript
interface ConversationBackend {
  getOrCreateConversation(threadId: string): Promise<Conversation>;
  listThreads(): Promise<{ threads: ThreadMeta[] }>;
  getThreadMeta(threadId: string): Promise<ThreadMeta | null>;
  updateThreadTitle(threadId: string, title: string): Promise<void>;
  getConversationData(threadId: string): Promise<{
    turns: unknown[];
    uploads?: unknown[];
  } | null>;
  artifactsDirForThread(threadId: string): string;
}
```

### `ThreadMeta`

```typescript
interface ThreadMeta {
  remoteId: string;
  title: string;
  status: "regular";
}
```
