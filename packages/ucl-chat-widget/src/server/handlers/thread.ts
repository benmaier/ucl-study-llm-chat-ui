/**
 * Factory for the single-thread handler.
 *
 * GET  /api/threads/[id] — thread metadata
 * PUT  /api/threads/[id] — rename thread
 */

import { ConversationStore } from "../conversation-store.js";
import { existsSync, readFileSync, writeFileSync } from "fs";

import type { ChatRouteConfig } from "../../types/config.js";

/**
 * Creates a single-thread route handler with the given configuration.
 * Returns `{ GET, PUT }` for use as a Next.js route module.
 */
export function createThreadHandler(config: ChatRouteConfig) {
  const store = ConversationStore.getInstance(config);

  async function GET(
    _req: Request,
    context: { params: Promise<{ id: string }> },
  ) {
    const { id } = await context.params;
    const meta = store.getConversationMeta(id);
    if (!meta) {
      return new Response("Not found", { status: 404 });
    }
    return Response.json(meta);
  }

  async function PUT(
    req: Request,
    context: { params: Promise<{ id: string }> },
  ) {
    const { id } = await context.params;
    const body = await req.json();
    const newTitle: string | undefined = body.title;

    const filePath = store.filePathForThread(id);
    if (!existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8"));
      if (!data.metadata) data.metadata = {};
      data.metadata.title = newTitle;
      writeFileSync(filePath, JSON.stringify(data, null, 2));
      return Response.json({ ok: true });
    } catch {
      return new Response("Failed to update", { status: 500 });
    }
  }

  return { GET, PUT };
}
