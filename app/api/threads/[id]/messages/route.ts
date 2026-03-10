/**
 * GET /api/threads/[id]/messages
 *
 * Reads conversation.json, uses the SDK to convert turns into
 * unified message format, then maps to AI SDK UIMessage parts.
 */

import {
  filePathForThread,
  artifactsDirForThread,
} from "@/app/api/chat/conversation-store";
import {
  convertTurnsToMessages,
  type UnifiedMessagePart,
} from "ucl-study-llm-chat-api";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import crypto from "crypto";
import path from "path";

/** AI SDK UIMessage part types */
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

/**
 * Write base64 file data to the artifacts dir.
 * Returns the artifact filename (UUID + ext) for URL construction.
 */
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

/**
 * Detect whether base64 data represents an image (PNG or JPEG).
 */
function isImageData(base64Data: string): boolean {
  const buf = Buffer.from(base64Data, "base64");
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  return isPng || isJpeg;
}

/**
 * Convert a UnifiedMessagePart to an AI SDK UIPart.
 *
 * User file parts → FileUIPart (renders as attachment tiles via assistant-ui).
 * Assistant file parts → written to disk, returned as markdown text.
 */
function toUIPart(
  part: UnifiedMessagePart,
  role: "user" | "assistant",
  threadId: string,
  artifactsDir: string,
  seenHashes: Set<string>,
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

      // User attachments → FileUIPart with data URL (renders as attachment tiles)
      if (role === "user") {
        const mediaType = part.mimeType ?? "application/octet-stream";
        const url = `data:${mediaType};base64,${part.base64Data}`;
        return {
          type: "file",
          mediaType,
          filename: part.filename,
          url,
        };
      }

      // Assistant generated files → write to disk, return as markdown
      const hash = crypto
        .createHash("sha256")
        .update(Buffer.from(part.base64Data, "base64"))
        .digest("hex");
      if (seenHashes.has(hash)) return null;
      seenHashes.add(hash);

      const artifactId = writeArtifact(
        part.base64Data,
        part.filename,
        artifactsDir,
      );
      const isImage = isImageData(part.base64Data);
      const displayName = isImage
        ? part.filename
        : part.filename.replace(/\.\w+$/, ".txt");
      const url = `/api/threads/${threadId}/artifacts/${artifactId}`;
      const md = isImage
        ? `![${displayName}](${url})`
        : `[${displayName}](${url})`;

      return { type: "text", text: `\n\n${md}\n\n` };
    }
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: threadId } = await params;
  const filePath = filePathForThread(threadId);

  if (!existsSync(filePath)) {
    return Response.json({ messages: [] });
  }

  let data: { turns: unknown[]; uploads?: unknown[] };
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return Response.json({ messages: [] });
  }

  const artifactsDir = artifactsDirForThread(threadId);
  const seenHashes = new Set<string>();

  // SDK converts turns to unified format with interleaved parts
  const unified = convertTurnsToMessages(
    data.turns as Parameters<typeof convertTurnsToMessages>[0],
    data.uploads as Parameters<typeof convertTurnsToMessages>[1],
  );

  // Map unified parts to AI SDK UIMessage format
  const messages: UIMessageOut[] = unified.map((msg) => ({
    role: msg.role,
    id: msg.id,
    parts: msg.parts
      .map((part) => toUIPart(part, msg.role, threadId, artifactsDir, seenHashes))
      .filter((p): p is UIPart => p !== null),
  }));

  return Response.json({ messages });
}
