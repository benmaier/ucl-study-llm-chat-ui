/**
 * Factory for the threads list handler.
 * GET /api/threads
 */

import { resolveBackend } from "../conversation-store.js";
import type { ChatRouteConfig } from "../../types/config.js";

export function createThreadsHandler(config: ChatRouteConfig) {
  const backend = resolveBackend(config);

  async function GET() {
    const result = await backend.listThreads();
    return Response.json(result);
  }

  return { GET };
}
