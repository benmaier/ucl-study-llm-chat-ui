# Installation

## Prerequisites

- Node.js >= 18 (tested on v24)
- Next.js >= 15 (tested on 16.1.6)
- React >= 19
- Tailwind CSS 4 with `@tailwindcss/postcss`
- An API key for at least one LLM provider (Anthropic, OpenAI, or Gemini)

## Installing the Widget

### From GitHub release tarball (recommended)

Each release includes a pre-built tarball attached as a GitHub release asset:

```bash
# Latest release (v0.3.0)
npm install https://github.com/benmaier/ucl-study-llm-chat-ui/releases/download/v0.3.0/ucl-chat-widget-0.3.0.tgz
```

Check [Releases](https://github.com/benmaier/ucl-study-llm-chat-ui/releases) for all available versions.

### From a local tarball

If you have the tarball file:

```bash
npm install ./ucl-chat-widget-0.3.0.tgz
```

### For development (monorepo)

```bash
git clone git@github.com:benmaier/ucl-study-llm-chat-ui.git
cd ucl-study-llm-chat-ui
npm install --legacy-peer-deps
npm run build
```

## Peer Dependencies

The widget requires these as peer dependencies (your app must install them):

```json
{
  "next": ">=15.0.0",
  "react": ">=19.0.0",
  "react-dom": ">=19.0.0",
  "ucl-study-llm-chat-api": ">=1.0.0"
}
```

Install the SDK:

```bash
npm install github:benmaier/ucl-study-llm-chat-api
```

## Next.js Configuration

Add both packages to `serverExternalPackages` in `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ucl-study-llm-chat-api", "ucl-chat-widget"],
};

export default nextConfig;
```

## Environment Variables

Create a `.env.local` file in your Next.js app root:

```env
# LLM Provider API Keys (at least one required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AI...

# Provider selection (default: "anthropic")
CHAT_PROVIDER=anthropic

# Conversation storage directory (default: "data/conversations")
CONVERSATIONS_DIR=data/conversations

# Optional: JSONL trace file directory for debugging
TRACE_DIR=data/traces

# Optional: verbose streaming event logging
DEBUG_STREAMS=1
```

API keys are read by the SDK directly from `process.env`. Alternatively, pass the key explicitly via `ChatRouteConfig.apiKey` (recommended for serverless environments like Vercel).

## CSS Setup

Your `app/globals.css` needs:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
```

Then either import the widget's theme CSS or copy the variables from `ucl-chat-widget/styles/globals.css`. The widget's CSS variables are namespaced with `--llmchat-*` to avoid collisions.

Add the `@source` directive so Tailwind scans the widget's source for class names:

```css
@source "../../packages/widget/src";
/* or for node_modules: */
@source "../node_modules/ucl-chat-widget/dist";
```

Add the cursor pointer fix (Tailwind CSS 4 preflight strips it):

```css
button, [role="button"], a, summary, select, label[for] {
  cursor: pointer;
}
```

## Fonts

The widget expects Inter and JetBrains Mono fonts via CSS variables:

```tsx
// app/layout.tsx
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
```

## Minimal Route Setup

Create 5 thin route files and a shared config:

```ts
// app/api/chat-config.ts
import type { ChatRouteConfig } from "ucl-chat-widget/server";

export const chatConfig: ChatRouteConfig = {
  provider: (process.env.CHAT_PROVIDER as any) || "anthropic",
  conversationsDir: process.env.CONVERSATIONS_DIR || "data/conversations",
  apiBasePath: "/api",
};
```

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

## Rendering the Widget

```tsx
// app/page.tsx
"use client";
import { ChatWidget } from "ucl-chat-widget/client";

export default function ChatPage() {
  return (
    <ChatWidget
      config={{
        sidebarTitle: "AI Assistant",
        apiBasePath: "/api",
        sidebarPanels: [
          {
            title: "Instructions",
            content: <p>Your instructions here...</p>,
            defaultExpanded: true,
          },
        ],
      }}
    />
  );
}
```

The widget includes its own `TooltipProvider` — your layout does NOT need one.
