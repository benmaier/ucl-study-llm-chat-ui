/**
 * Factory for the single-thread handler.
 * GET  /api/threads/[id] — thread metadata
 * PUT  /api/threads/[id] — rename thread
 */

import { resolveBackend } from "../conversation-store.js";
import type { ChatRouteConfig } from "../../types/config.js";

export function createThreadHandler(config: ChatRouteConfig) {
  const backend = resolveBackend(config);

  async function GET(
    _req: Request,
    context: { params: Promise<{ id: string }> },
  ) {
    const { id } = await context.params;
    const meta = await backend.getThreadMeta(id);
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

    if (!newTitle) {
      return new Response("Missing title", { status: 400 });
    }

    try {
      await backend.updateThreadTitle(id, newTitle);
      return Response.json({ ok: true });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  return { GET, PUT };
}
