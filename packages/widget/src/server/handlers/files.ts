/**
 * Factory for the generated files handler.
 *
 * GET /api/threads/[id]/files/[fileId]
 *
 * Serves generated files (plots, CSVs, text) from the conversation's
 * stored base64Data — NOT from the filesystem. Works on serverless.
 */

import { resolveBackend } from "../conversation-store.js";
import type { ChatRouteConfig } from "../../types/config.js";

export function createFilesHandler(config: ChatRouteConfig) {
  const backend = resolveBackend(config);

  async function GET(
    _req: Request,
    context: { params: Promise<{ id: string; fileId: string }> },
  ) {
    const { id: threadId, fileId } = await context.params;

    const data = await backend.getConversationData(threadId);
    if (!data) {
      return new Response("Not found", { status: 404 });
    }

    // Search all turns for a generatedFile matching fileId
    const turns = Array.isArray(data.turns) ? data.turns : [];
    for (const turn of turns) {
      const files = (turn as any).generatedFiles ?? [];
      for (const file of files) {
        if (file.fileId === fileId && file.base64Data) {
          const buffer = Buffer.from(file.base64Data, "base64");
          const mimeType = file.mimeType || "application/octet-stream";
          const filename = file.filename || "download";
          return new Response(buffer, {
            headers: {
              "Content-Type": mimeType,
              "Content-Disposition": `attachment; filename="${filename}"`,
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        }
      }

      // Also check inlineImages
      const inlineImages = (turn as any).inlineImages ?? [];
      for (let i = 0; i < inlineImages.length; i++) {
        const imgId = `inline-image-${(turn as any).turnNumber}-${i}`;
        if (imgId === fileId && inlineImages[i].base64Data) {
          const buffer = Buffer.from(inlineImages[i].base64Data, "base64");
          const mimeType = inlineImages[i].mediaType || "image/png";
          const ext = mimeType.split("/")[1] || "png";
          return new Response(buffer, {
            headers: {
              "Content-Type": mimeType,
              "Content-Disposition": `attachment; filename="image-${i + 1}.${ext}"`,
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        }
      }
    }

    return new Response("File not found", { status: 404 });
  }

  return { GET };
}
