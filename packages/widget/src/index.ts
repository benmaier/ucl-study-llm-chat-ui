// Client exports
export { ChatWidget, ChatWidgetConfigProvider, useChatWidgetConfig } from "./client/index.js";

// Server exports
export {
  createChatHandler,
  createThreadsHandler,
  createThreadHandler,
  createMessagesHandler,
  createArtifactsHandler,
  ConversationStore,
} from "./server/index.js";

// Types
export type { ChatWidgetConfig, SidebarPanel, ChatRouteConfig } from "./types/config.js";
