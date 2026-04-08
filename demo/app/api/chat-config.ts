import type { ChatRouteConfig } from "ucl-chat-widget/server";

export const chatConfig: ChatRouteConfig = {
  provider: (process.env.CHAT_PROVIDER as ChatRouteConfig["provider"]) || "anthropic",
  model: process.env.CHAT_MODEL || undefined,
  conversationsDir: process.env.CONVERSATIONS_DIR || "data/conversations",
  traceDir: process.env.TRACE_DIR,
  debugStreams: !!process.env.DEBUG_STREAMS,
  apiBasePath: "/api",
};
