/**
 * Chat API route — uses the SDK Conversation class for multi-turn
 * state, persistence, and code execution support.
 *
 * Streams responses using the assistant-ui v1 SSE protocol.
 */

import { getOrCreateConversation, artifactsDirForThread } from "./conversation-store";
import { createSseStream } from "./stream-mapper";
import { mkdirSync } from "fs";
import path from "path";

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

/**
 * Extract text from a single UIMessage (parts-based or content string).
 */
function extractText(msg: UIMessage | undefined): string {
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

/**
 * Extract file parts from a UIMessage.
 */
function extractFiles(
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

/**
 * Decode a data URL to a Buffer.
 */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",")[1];
  return Buffer.from(base64, "base64");
}

export async function POST(req: Request) {
  const body = await req.json();
  const threadId: string = body.id ?? "default";
  const messages: UIMessage[] = body.messages ?? [];

  // Only send the latest user message — Conversation tracks history internally
  const lastUserMsg = messages.filter((m) => m.role === "user").pop();
  const messageText = extractText(lastUserMsg);

  if (!messageText) {
    return new Response(JSON.stringify({ error: "No user message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const conversation = await getOrCreateConversation(threadId);

  // Upload any attached files
  const fileParts = extractFiles(lastUserMsg);
  const fileIds: string[] = [];
  for (const file of fileParts) {
    const buffer = dataUrlToBuffer(file.url);
    const uploaded = await conversation.uploadFileFromBuffer(
      buffer,
      file.filename,
      file.mediaType,
    );
    fileIds.push(uploaded.file_id);
  }

  // Prepend filename context so models know original names
  // (Gemini renames uploads to input_file_0, input_file_1, etc.)
  let finalMessage = messageText;
  if (fileParts.length > 0) {
    const fileList = fileParts
      .map((f, i) => `  input_file_${i}: "${f.filename}"`)
      .join("\n");
    finalMessage = `[Attached files:\n${fileList}]\n\n${messageText}`;
  }

  // Create trace file if TRACE_DIR env var is set
  let traceFile: string | undefined;
  const traceDir = process.env.TRACE_DIR;
  if (traceDir) {
    mkdirSync(traceDir, { recursive: true });
    traceFile = path.join(traceDir, `trace-${threadId}-${Date.now()}.jsonl`);
    console.log(`[route] Tracing enabled → ${traceFile}`);
  }

  const stream = createSseStream(conversation, finalMessage, {
    fileIds: fileIds.length > 0 ? fileIds : undefined,
    artifactsDir: artifactsDirForThread(threadId),
    threadId,
    traceFile,
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
