import type { ReactNode } from "react";

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

/** Server-side configuration for route handler factories. */
export interface ChatRouteConfig {
  /** LLM provider */
  provider: "anthropic" | "openai" | "gemini";
  /** Directory for conversation persistence */
  conversationsDir: string;
  /** Optional JSONL trace directory */
  traceDir?: string;
  /** Enable verbose stream logging */
  debugStreams?: boolean;
  /** API route base path — must match client apiBasePath (default: "/api") */
  apiBasePath?: string;
}
