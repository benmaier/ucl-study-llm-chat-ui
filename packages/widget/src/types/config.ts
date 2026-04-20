import type { ReactNode } from "react";
import type { Conversation, ConversationWriter } from "ucl-study-llm-chat-api";

/** A panel displayed in the right sidebar. */
export interface SidebarPanel {
  title: string;
  content: ReactNode;
  defaultExpanded?: boolean;
}

/** Client-side widget configuration (safe for browser). */
export interface ChatWidgetConfig {
  /** Left sidebar title (default: "AI Assist") */
  sidebarTitle?: string;
  /** Welcome message shown on empty threads */
  welcomeMessage?: string;
  /** Thread list section label (default: "Your chats") */
  threadListLabel?: string;
  /** Right sidebar panels — pass empty array to hide sidebar */
  sidebarPanels?: SidebarPanel[];
  /** API route base path (default: "/api") */
  apiBasePath?: string;
}

/** Thread metadata for the sidebar. */
export interface ThreadMeta {
  remoteId: string;
  title: string;
  status: "regular";
}

/**
 * Pluggable conversation storage backend.
 *
 * The default implementation (`FileConversationBackend`) uses the filesystem.
 * Implement this interface to back conversations with a database instead.
 */
export interface ConversationBackend {
  /** Get or create a Conversation instance for the given thread. */
  getOrCreateConversation(threadId: string): Promise<Conversation>;
  /** List all threads for the sidebar. */
  listThreads(): Promise<{ threads: ThreadMeta[] }>;
  /** Get metadata for a single thread, or null if not found. */
  getThreadMeta(threadId: string): Promise<ThreadMeta | null>;
  /** Update a thread's title. */
  updateThreadTitle(threadId: string, title: string): Promise<void>;
  /** Get raw conversation data (turns + uploads) for history loading. Returns null if not found. */
  getConversationData(threadId: string): Promise<{ turns: unknown[]; uploads?: unknown[] } | null>;
  /** Path to the artifacts directory for a given thread (for file storage). */
  artifactsDirForThread(threadId: string): string;
  /** Called when a user message is received, before send(). Store it immediately so the conversation is non-empty. */
  onUserMessageReceived?(threadId: string, message: string): Promise<void>;
  /** Resolve an API key for side-channel LLM calls (e.g. title generation)
   *  that bypass the main `send()` path. Backends backed by a key pool
   *  should implement this so one-shot helpers can borrow a key without
   *  going through the main turn flow.
   *
   *  If omitted (or it returns `undefined`), callers fall back to
   *  `ChatRouteConfig.apiKey`, then to the SDK client's env-var default. */
  getApiKey?(provider: "anthropic" | "openai" | "gemini"): Promise<string | undefined>;
}

/** Server-side configuration for route handler factories. */
export interface ChatRouteConfig {
  /**
   * Custom conversation backend. When provided, `provider` and
   * `conversationsDir` are ignored — the backend handles all storage.
   */
  backend?: ConversationBackend;
  /** LLM provider — required when using the default filesystem backend */
  provider?: "anthropic" | "openai" | "gemini";
  /** Model override (e.g. "claude-haiku-4-5-20251001", "gpt-4o"). Falls back to SDK default per provider. */
  model?: string;
  /** Directory for conversation persistence — required when using the default filesystem backend */
  conversationsDir?: string;
  /** Additional writers (e.g. DatabaseWriter) injected alongside the default FileWriter */
  extraWriters?: ConversationWriter[];
  /** Optional JSONL trace directory */
  traceDir?: string;
  /** Enable verbose stream logging */
  debugStreams?: boolean;
  /** API route base path — must match client apiBasePath (default: "/api") */
  apiBasePath?: string;
  /** API key for the LLM provider. When set, passed to the Conversation
   *  constructor instead of relying on process.env. Critical for serverless
   *  environments where concurrent requests share the same process. */
  apiKey?: string;
  /** Fallback provider if the primary fails or returns empty. Passed to SDK. */
  fallbackProvider?: "anthropic" | "openai" | "gemini";
  /** Fallback model override for the fallback provider. */
  fallbackModel?: string;
}
