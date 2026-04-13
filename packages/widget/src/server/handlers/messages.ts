/**
 * Factory for the thread messages handler.
 * GET /api/threads/[id]/messages
 */

import { resolveBackend } from "../conversation-store.js";
import {
  convertTurnsToMessages,
  type UnifiedMessagePart,
} from "ucl-study-llm-chat-api";
import { writeFileSync, mkdirSync } from "fs";
import crypto from "crypto";
import path from "path";

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

function writeArtifact(
  base64Data: string,
  filename: string,
  artifactsDir: string,
): string {
  const origExt = path.extname(filename || ".png") || ".png";
  const buf = Buffer.from(base64Data, "base64");
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const ext = isPng || isJpeg ? origExt : ".txt";

  const id = crypto.randomUUID() + ext;
  const filePath = path.join(artifactsDir, id);
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(filePath, buf);
  return id;
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
  artifactsDir: string,
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
      const displayName = isImage
        ? part.filename
        : part.filename.replace(/\.\w+$/, ".txt");

      // Link to /api/threads/{id}/files/{fileId} — serves from stored base64Data
      const url = `${apiBasePath}/threads/${threadId}/files/${part.fileId}`;

      if (isImage) {
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

    const artifactsDir = backend.artifactsDirForThread(threadId);
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
          toUIPart(part, msg.role, threadId, artifactsDir, seenHashes, apiBasePath),
        )
        .filter((p): p is UIPart => p !== null),
    }));

    return Response.json({ messages });
  }

  return { GET };
}
