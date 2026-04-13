/**
 * Factory for the thread messages handler.
 * GET /api/threads/[id]/messages
 */

import { resolveBackend } from "../conversation-store.js";
import {
  convertTurnsToMessages,
  type UnifiedMessagePart,
} from "ucl-study-llm-chat-api";
import crypto from "crypto";

import type { ChatRouteConfig } from "../../types/config.js";

interface TextUIPart {
  type: "text";
  text: string;
}

interface DynamicToolUIPart {
  type: "dynamic-tool";
  toolName: string;
  toolCallId: string;
  state: "output-available";
  input: unknown;
  output: unknown;
}

interface FileUIPart {
  type: "file";
  mediaType: string;
  filename?: string;
  url: string;
}

type UIPart = TextUIPart | DynamicToolUIPart | FileUIPart;

interface UIMessageOut {
  role: "user" | "assistant";
  id: string;
  parts: UIPart[];
}

function isImageData(base64Data: string): boolean {
  const buf = Buffer.from(base64Data, "base64");
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  return isPng || isJpeg;
}

function toUIPart(
  part: UnifiedMessagePart,
  role: "user" | "assistant",
  threadId: string,
  seenHashes: Set<string>,
  apiBasePath: string,
): UIPart | null {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };

    case "tool-call":
      return {
        type: "dynamic-tool",
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        state: "output-available",
        input: part.input,
        output: part.output ?? "Execution complete",
      };

    case "file": {
      if (!part.base64Data) return null;

      if (role === "user") {
        const mediaType = part.mimeType ?? "application/octet-stream";
        const url = `data:${mediaType};base64,${part.base64Data}`;
        return { type: "file", mediaType, filename: part.filename, url };
      }

      const hash = crypto
        .createHash("sha256")
        .update(Buffer.from(part.base64Data, "base64"))
        .digest("hex");
      if (seenHashes.has(hash)) return null;
      seenHashes.add(hash);

      const isImage = isImageData(part.base64Data);
      const displayName = part.filename;

      // Serve via /api/threads/{id}/files/{fileId} — reads from stored base64Data
      const url = `${apiBasePath}/threads/${threadId}/files/${part.fileId}`;

      if (isImage) {
        // Skip blank/tiny images (Gemini's plt.show() emits empty canvases)
        if (part.base64Data && part.base64Data.length < 1000) return null;
        return { type: "text", text: `\n\n![${displayName}](${url})\n\n` };
      }
      return { type: "text", text: `\n\n[${displayName}](${url})\n\n` };
    }
  }
}

export function createMessagesHandler(config: ChatRouteConfig) {
  const backend = resolveBackend(config);
  const apiBasePath = config.apiBasePath ?? "/api";

  async function GET(
    _req: Request,
    context: { params: Promise<{ id: string }> },
  ) {
    const { id: threadId } = await context.params;

    const data = await backend.getConversationData(threadId);
    if (!data) {
      return Response.json({ messages: [] });
    }

    const seenHashes = new Set<string>();

    const unified = convertTurnsToMessages(
      data.turns as Parameters<typeof convertTurnsToMessages>[0],
      data.uploads as Parameters<typeof convertTurnsToMessages>[1],
    );

    const messages: UIMessageOut[] = unified.map((msg) => ({
      role: msg.role,
      id: msg.id,
      parts: msg.parts
        .map((part) =>
          toUIPart(part, msg.role, threadId, seenHashes, apiBasePath),
        )
        .filter((p): p is UIPart => p !== null),
    }));

    return Response.json({ messages });
  }

  return { GET };
}
