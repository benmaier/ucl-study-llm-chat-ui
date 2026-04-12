/**
 * Factory for the chat POST handler.
 */

import { resolveBackend } from "../conversation-store.js";
import { createSseStream } from "../stream-mapper.js";
import { mkdirSync } from "fs";
import path from "path";

import type { ChatRouteConfig } from "../../types/config.js";

interface UIMessagePart {
  type: string;
  text?: string;
  url?: string;
  mediaType?: string;
  filename?: string;
}

interface UIMessage {
  role: string;
  content?: string;
  parts?: UIMessagePart[];
}

export function extractText(msg: UIMessage | undefined): string {
  if (!msg) return "";
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("");
  }
  if (typeof msg.content === "string") {
    return msg.content;
  }
  return "";
}

export function extractFiles(
  msg: UIMessage | undefined,
): Array<{ url: string; mediaType: string; filename: string }> {
  if (!msg || !Array.isArray(msg.parts)) return [];
  return msg.parts
    .filter((p) => p.type === "file" && p.url)
    .map((p) => ({
      url: p.url!,
      mediaType: p.mediaType || "application/octet-stream",
      filename: p.filename || "upload",
    }));
}

export function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",")[1];
  return Buffer.from(base64, "base64");
}

export function createChatHandler(config: ChatRouteConfig) {
  const backend = resolveBackend(config);

  async function POST(req: Request) {
    const body = await req.json();
    const threadId: string = body.id ?? "default";
    const messages: UIMessage[] = body.messages ?? [];

    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    const messageText = extractText(lastUserMsg);

    console.log(`[chat] POST threadId=${threadId} msgLen=${messageText?.length ?? 0} totalMsgs=${messages.length}`);

    if (!messageText) {
      console.warn(`[chat] No user message found in request for thread ${threadId}`);
      return new Response(JSON.stringify({ error: "No user message" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const conversation = await backend.getOrCreateConversation(threadId);

    const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);
    const fileParts = extractFiles(lastUserMsg);
    const fileIds: string[] = [];
    const images: Array<{ base64Data: string; mediaType: string }> = [];
    const nonImageParts: typeof fileParts = [];

    for (const file of fileParts) {
      if (IMAGE_MIMES.has(file.mediaType)) {
        // Images: send inline as visual content, don't upload
        const buffer = dataUrlToBuffer(file.url);
        images.push({ base64Data: buffer.toString("base64"), mediaType: file.mediaType });
      } else {
        // Non-images: upload to provider's file storage for code execution
        const buffer = dataUrlToBuffer(file.url);
        const uploaded = await conversation.uploadFileFromBuffer(
          buffer,
          file.filename,
          file.mediaType,
        );
        fileIds.push(uploaded.file_id);
        nonImageParts.push(file);
      }
    }

    if (fileParts.length > 0) {
      console.log(`[chat] Files: ${images.length} images (inline), ${fileIds.length} non-image (uploaded)`);
    }

    let finalMessage = messageText;
    if (nonImageParts.length > 0) {
      const fileList = nonImageParts
        .map((f, i) => `  input_file_${i}: "${f.filename}"`)
        .join("\n");
      finalMessage = `[Attached files:\n${fileList}]\n\n${messageText}`;
    }

    let traceFile: string | undefined;
    if (config.traceDir) {
      mkdirSync(config.traceDir, { recursive: true });
      traceFile = path.join(config.traceDir, `trace-${threadId}-${Date.now()}.jsonl`);
      console.log(`[route] Tracing enabled -> ${traceFile}`);
    }

    const stream = createSseStream(conversation, finalMessage, {
      fileIds: fileIds.length > 0 ? fileIds : undefined,
      images: images.length > 0 ? images : undefined,
      artifactsDir: backend.artifactsDirForThread(threadId),
      threadId,
      traceFile,
      apiBasePath: config.apiBasePath,
      deferToolOutput: config.provider === "openai",
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-vercel-ai-ui-message-stream": "v1",
      },
    });
  }

  return { POST };
}
