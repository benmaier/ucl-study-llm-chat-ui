/**
 * GET  /api/threads/[id] — thread metadata
 * PUT  /api/threads/[id] — rename thread
 */

import {
  getConversationMeta,
  filePathForThread,
} from "@/app/api/chat/conversation-store";
import { existsSync, readFileSync, writeFileSync } from "fs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const meta = getConversationMeta(id);
  if (!meta) {
    return new Response("Not found", { status: 404 });
  }
  return Response.json(meta);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const newTitle: string | undefined = body.title;

  const filePath = filePathForThread(id);
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
