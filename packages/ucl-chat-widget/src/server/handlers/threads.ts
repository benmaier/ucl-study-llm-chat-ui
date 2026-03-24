/**
 * Factory for the threads list handler.
 *
 * GET /api/threads — returns list of all conversations for the sidebar.
 */

import { ConversationStore } from "../conversation-store.js";

import type { ChatRouteConfig } from "../../types/config.js";

/**
 * Creates a threads list route handler with the given configuration.
 * Returns `{ GET }` for use as a Next.js route module.
 */
export function createThreadsHandler(config: ChatRouteConfig) {
  const store = ConversationStore.getInstance(config);

  async function GET() {
    const result = store.scanConversations();
    return Response.json(result);
  }

  return { GET };
}
