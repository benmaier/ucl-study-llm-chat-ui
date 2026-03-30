# Architecture

## Workspace Layout

The repo is an npm workspaces monorepo with two packages:

- **`packages/widget/`** — The `ucl-chat-widget` npm package. Built with tsup (ESM only). Contains all chat UI components, server-side route handler factories, the SSE stream mapper, and the conversation storage backend.
- **`demo/`** — A Next.js 16 reference app that imports the widget. Contains thin route wrappers, Playwright E2E tests, and study-specific sidebar content.

Vitest (widget unit tests) and Playwright (demo E2E tests) are isolated in separate workspaces to avoid the `expect` global conflict between the two frameworks.

## Widget Package Structure

```
packages/widget/src/
├── index.ts                 # Re-exports client + server + types
├── client/
│   ├── index.ts             # "use client" barrel export
│   ├── chat-widget.tsx      # <ChatWidget config={...} /> entry point
│   ├── assistant.tsx         # Runtime orchestration (354 lines)
│   ├── config-context.tsx   # React context for ChatWidgetConfig
│   └── components/
│       ├── assistant-ui/    # Chat-specific components
│       │   ├── thread.tsx          # Message thread with auto-scroll
│       │   ├── markdown-text.tsx   # Markdown rendering + syntax highlighting
│       │   ├── tool-fallback.tsx   # Collapsible tool call cards
│       │   ├── attachment.tsx      # File attachment tiles + lightbox
│       │   └── tooltip-icon-button.tsx
│       ├── left-sidebar.tsx        # 250px, collapsible
│       ├── right-sidebar.tsx       # 365px, collapsible
│       ├── info-card.tsx           # Collapsible card with Read more/less
│       ├── thread-list.tsx         # Sidebar thread list with inline rename
│       ├── image-lightbox.tsx      # Click-to-expand image overlay
│       ├── ui/                     # Radix-based primitives (shadcn style)
│       │   ├── avatar.tsx, button.tsx, collapsible.tsx, dialog.tsx, tooltip.tsx
│       └── lib/utils.ts           # cn() helper
├── server/
│   ├── index.ts                    # Server barrel export
│   ├── conversation-store.ts       # FileConversationBackend + resolveBackend()
│   ├── stream-mapper.ts            # SSE protocol bridge (447 lines)
│   └── handlers/
│       ├── chat.ts                 # POST /api/chat
│       ├── threads.ts              # GET /api/threads
│       ├── thread.ts               # GET/PUT /api/threads/[id]
│       ├── messages.ts             # GET /api/threads/[id]/messages
│       └── artifacts.ts            # GET /api/threads/[id]/artifacts/[fileId]
├── types/
│   └── config.ts                   # All exported interfaces
└── styles/
    └── globals.css                 # --llmchat-* CSS variables
```

## Client Runtime Flow

The widget uses [assistant-ui](https://assistant-ui.com/) for the chat UI runtime:

```
ChatWidget
  └── ChatWidgetConfigProvider (React context)
      └── TooltipProvider
          └── Assistant
              └── AssistantRuntimeProvider
                  ├── RemoteIdTracker      ← syncs module-level currentRemoteId
                  ├── ThreadListSyncer     ← polls every 10s + visibility change
                  └── MainContent          ← 3-column responsive layout
                      ├── LeftSidebar → ThreadList
                      ├── Thread (center)
                      └── RightSidebar → InfoCards
```

### Runtime Architecture

1. **Outer runtime**: `useRemoteThreadListRuntime` manages the thread list via a `RemoteThreadListAdapter` that fetches from `/api/threads`.
2. **Inner runtime**: `useInnerRuntime()` creates a per-thread runtime using `useChat` (AI SDK) + `useAISDKRuntime` (assistant-ui bridge).
3. **Thread ID bridge**: A module-level `currentRemoteId` variable is synced by `RemoteIdTracker`. The transport's `prepareSendMessagesRequest` callback reads it to inject the correct thread ID into API calls.
4. **History loading**: When switching to an existing thread, `useEffect` fetches `/api/threads/{remoteId}/messages` and loads them via `chat.setMessages()`.

### Why `chat.setMessages()` Instead of `runtime.thread.reset()`

`runtime.thread.reset()` does NOT work with AI SDK runtimes — imported ThreadMessages lack UIMessage bindings, causing `onImport` to clear chatHelpers state. Always use `chat.setMessages()` directly.

## SSE Protocol Bridge

The stream mapper (`stream-mapper.ts`) converts SDK `StreamEvent` objects into the [assistant-ui v1 SSE wire protocol](https://assistant-ui.com/docs/advanced/custom-backend):

| SDK Event | SSE Event | Notes |
|-----------|-----------|-------|
| `text` | `text-start` / `text-delta` / `text-end` | Text blocks open/close around tools |
| `tool_start` | `tool-input-start` | Closes any open text block first |
| `tool_input` / `code` | `tool-input-delta` | Code input streamed as deltas |
| `code_executing` / `code_complete` | `tool-input-available` | Input finalized |
| `code_output` | `tool-output-available` | May be deferred (see below) |
| `tool_end` | (flushes tool) | Emits output if available, otherwise defers |

### Deferred Output Queue (OpenAI)

OpenAI's Responses API sends `code_output` events only after the entire stream ends, not inline with each tool. The stream mapper handles this with a FIFO deferred queue:

1. `tool_end` fires with no accumulated output → tool ID pushed to `deferredOutputTools`
2. Later `code_output` arrives → pops from queue, emits `tool-output-available` with correct `toolCallId`
3. After stream ends, any remaining deferred tools get a "Execution complete" placeholder

Anthropic and Gemini send `code_output` inline (before or right after `tool_end`), so the deferred queue stays empty for those providers.

### Generated Files

After `conversation.send()` completes, the stream mapper:

1. Downloads files from the provider via `conversation.downloadFiles()`
2. Deduplicates by SHA-256 hash
3. Detects file type from magic bytes (PNG: `89 50 4E 47`, JPEG: `FF D8`)
4. Saves to `artifactsDir` with UUID filenames
5. Emits markdown links as `text-delta` events: `![filename](/api/threads/{id}/artifacts/{uuid}.png)`

## Storage Backend

The `ConversationBackend` interface abstracts conversation storage:

```typescript
interface ConversationBackend {
  getOrCreateConversation(threadId: string): Promise<Conversation>;
  listThreads(): Promise<{ threads: ThreadMeta[] }>;
  getThreadMeta(threadId: string): Promise<ThreadMeta | null>;
  updateThreadTitle(threadId: string, title: string): Promise<void>;
  getConversationData(threadId: string): Promise<{ turns: unknown[]; uploads?: unknown[] } | null>;
  artifactsDirForThread(threadId: string): string;
}
```

### Default: FileConversationBackend

Filesystem-based. Directory layout:

```
{conversationsDir}/
  {threadId}/
    conversation.json       # Persisted conversation (turns, uploads, metadata)
    artifacts/
      {uuid}.png            # Generated files (plots, CSVs, text)
```

Features:
- In-memory LRU cache with 30-minute idle timeout
- Auto-eviction every 5 minutes
- Resume from disk on cache miss
- Thread ID sanitization (prevents path traversal)
- Auto-generated titles: "Chat 01", "Chat 02" by creation order, newest first

### Custom Backend

Pass `config.backend` to use a database-backed implementation (e.g. PostgreSQL). The `provider` and `conversationsDir` fields are ignored when `backend` is provided.

`extraWriters` allows injecting additional `ConversationWriter` instances (e.g. a `DatabaseWriter`) alongside the default `FileWriter`, without replacing the entire backend.

## Responsive Layout

The 3-column layout auto-collapses based on viewport width:

| Viewport | Left Sidebar | Center Chat | Right Sidebar |
|----------|-------------|-------------|---------------|
| > 1100px | Visible | Visible | Visible |
| 768-1100px | Visible | Visible | Hidden |
| < 768px | Hidden | Visible | Hidden |

Both sidebars have manual toggle buttons (PanelLeftIcon / PanelRightIcon). Manual overrides reset when the viewport crosses a breakpoint.

## Cross-Tab Sync

The `ThreadListSyncer` component keeps the thread list in sync:

- **Polling**: Re-fetches the thread list every 10 seconds
- **Visibility**: Refreshes immediately when the tab becomes visible
- **New thread**: `initialize()` fetches the current thread list before creating a new thread to ensure correct numbering

Uses assistant-ui internals (`_loadThreadsPromise`) to force a re-fetch, wrapped in try/catch for graceful degradation.
