/**
 * Serves artifact files (plots, text outputs) for a conversation.
 * Files are stored in {conversationsDir}/{threadId}/artifacts/
 */

import { readFileSync, existsSync } from "fs";
import path from "path";
import { artifactsDirForThread } from "@/app/api/chat/conversation-store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;

  // Sanitize to prevent path traversal
  const safeFileId = fileId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const filePath = path.join(artifactsDirForThread(id), safeFileId);

  if (!existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const data = readFileSync(filePath);
  const ext = path.extname(safeFileId).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".txt": "text/plain; charset=utf-8",
  };

  return new Response(data, {
    headers: {
      "Content-Type": mimeMap[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
