/**
 * Factory for the artifacts file handler.
 * GET /api/threads/[id]/artifacts/[fileId]
 */

import { readFileSync, existsSync } from "fs";
import path from "path";
import { resolveBackend } from "../conversation-store.js";

import type { ChatRouteConfig } from "../../types/config.js";

export function createArtifactsHandler(config: ChatRouteConfig) {
  const backend = resolveBackend(config);

  async function GET(
    _req: Request,
    context: { params: Promise<{ id: string; fileId: string }> },
  ) {
    const { id, fileId } = await context.params;

    const safeFileId = fileId.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filePath = path.join(backend.artifactsDirForThread(id), safeFileId);

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

  return { GET };
}
