# Configuration

## ChatWidgetConfig (Client)

Passed to `<ChatWidget config={...} />`. All fields are optional with sensible defaults.

```tsx
<ChatWidget
  config={{
    sidebarTitle: "Research Assistant",    // Left sidebar heading
    welcomeMessage: "Ask me anything.",    // Empty thread welcome
    threadListLabel: "Conversations",      // Label above thread list
    apiBasePath: "/api",                   // Must match server config
    sidebarPanels: [                       // Right sidebar (empty = hidden)
      {
        title: "Scenario",
        content: <p>Your study scenario...</p>,
        defaultExpanded: true,
      },
      {
        title: "Tasks",
        content: <ul><li>Task 1</li><li>Task 2</li></ul>,
      },
    ],
  }}
/>
```

### Hiding the Right Sidebar

Pass an empty array or omit `sidebarPanels`:

```tsx
<ChatWidget config={{ sidebarPanels: [] }} />
```

## ChatRouteConfig (Server)

Passed to all handler factories. Supports two modes:

### Mode A: Filesystem Backend (Default)

```ts
const chatConfig: ChatRouteConfig = {
  provider: "anthropic",
  conversationsDir: "data/conversations",
  apiBasePath: "/api",
};
```

### Mode B: Custom Backend

```ts
const chatConfig: ChatRouteConfig = {
  backend: new PostgresConversationBackend(pool),
  apiBasePath: "/api",
};
```

When `backend` is provided, `provider` and `conversationsDir` are ignored.

### Mode A + Extra Writers

```ts
const chatConfig: ChatRouteConfig = {
  provider: "openai",
  conversationsDir: "data/conversations",
  extraWriters: [new DatabaseWriter(pool)],
  apiBasePath: "/api",
};
```

`extraWriters` are appended after the default `FileWriter`. They receive turn data via `ConversationWriter.onTurnComplete()`.

### API Key (Serverless)

```ts
const chatConfig: ChatRouteConfig = {
  provider: "anthropic",
  conversationsDir: "/tmp/conversations",
  apiKey: process.env.ANTHROPIC_API_KEY,
  apiBasePath: "/api",
};
```

When `apiKey` is set, it's passed to the `Conversation` constructor and forwarded to all API calls including file downloads. This is critical for serverless (Vercel) where `process.env` may not be available in all contexts.

## ConversationBackend Interface

Implement this to replace the filesystem with a database:

```typescript
class PostgresConversationBackend implements ConversationBackend {
  async getOrCreateConversation(threadId: string): Promise<Conversation> {
    // Load from DB or create new
  }

  async listThreads(): Promise<{ threads: ThreadMeta[] }> {
    // SELECT id, title FROM conversations ORDER BY created_at DESC
  }

  async getThreadMeta(threadId: string): Promise<ThreadMeta | null> {
    // SELECT by id
  }

  async updateThreadTitle(threadId: string, title: string): Promise<void> {
    // UPDATE conversations SET title = $1 WHERE id = $2
  }

  async getConversationData(threadId: string): Promise<{ turns: unknown[]; uploads?: unknown[] } | null> {
    // Return raw turns + uploads for history loading
  }

  artifactsDirForThread(threadId: string): string {
    // Still needs a filesystem path for generated files (plots, CSVs)
    return `/tmp/artifacts/${threadId}`;
  }
}
```

Note: `artifactsDirForThread()` must return a filesystem path because generated files are written to disk and served by the artifacts route handler. On serverless platforms where `/tmp` is ephemeral, consider serving artifacts from `base64Data` stored in your database instead.

## CSS Variables

All CSS variables are namespaced with `--llmchat-*` to avoid collisions with the parent app:

```css
:root {
  --llmchat-background: oklch(1 0 0);
  --llmchat-foreground: oklch(0.145 0 0);
  --llmchat-primary: oklch(0.205 0 0);
  --llmchat-primary-foreground: oklch(0.985 0 0);
  --llmchat-secondary: oklch(0.97 0 0);
  --llmchat-muted: oklch(0.97 0 0);
  --llmchat-muted-foreground: oklch(0.556 0 0);
  --llmchat-border: oklch(0.922 0 0);
  --llmchat-ring: oklch(0.708 0 0);
  --llmchat-radius: 0.625rem;
  --llmchat-sidebar: oklch(0.985 0 0);
  /* ... and more (see src/styles/globals.css for full list) */
}

.dark {
  --llmchat-background: #212121;
  --llmchat-foreground: #ffffff;
  --llmchat-primary: #ffffff;
  --llmchat-secondary: #303030;
  --llmchat-muted: #303030;
  --llmchat-muted-foreground: #afafaf;
  --llmchat-border: #2f2f32;
  --llmchat-sidebar: #181818;
  /* ... */
}
```

The `@theme inline` block maps these to Tailwind's color system:

```css
@theme inline {
  --color-background: var(--llmchat-background);
  --color-foreground: var(--llmchat-foreground);
  --color-primary: var(--llmchat-primary);
  /* ... */
}
```

This means Tailwind utility classes like `bg-background`, `text-muted-foreground`, `border-border` reference the `--llmchat-*` variables. To customize colors, override the `--llmchat-*` variables in your own CSS.

## Tailwind CSS 4 Setup

The widget requires Tailwind CSS 4 with the `@tailwindcss/postcss` plugin:

```js
// postcss.config.mjs
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

Your `globals.css` must include:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* Tell Tailwind to scan widget source for class names */
@source "../../packages/widget/src";
/* or from node_modules: */
@source "../node_modules/ucl-chat-widget/dist";
```

The `@source` directive is required because Tailwind CSS 4's auto-detection does not scan `node_modules`.
