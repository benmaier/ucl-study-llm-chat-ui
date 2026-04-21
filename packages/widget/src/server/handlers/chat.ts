/**
 * Factory for the chat POST handler.
 */

import { resolveBackend } from "../conversation-store.js";
import { createSseStream } from "../stream-mapper.js";
import { generateThreadTitle } from "../title-gen.js";
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
    const isFirstTurn = conversation.getTurns().length === 0;

    // Notify backend of user message before send() — so the conversation is non-empty in the DB
    if (backend.onUserMessageReceived) {
      await backend.onUserMessageReceived(threadId, messageText);
    }

    // Title generation on the first user message. Runs in parallel with send(),
    // but is awaited by the SSE stream before controller.close() so the
    // serverless function can't freeze before the DB write lands. On failure
    // the title stays null and the sidebar falls back to "Chat N".
    //
    // Provider is read from the Conversation instance (not config.provider)
    // so this works for custom backends that don't set config.provider.
    // API key resolves via backend.getApiKey() (for pool-backed backends)
    // then config.apiKey, then the SDK client's env-var fallback.
    let titleTask: Promise<void> | undefined;
    if (isFirstTurn) {
      const provider = conversation.getProvider();
      titleTask = (async () => {
        const apiKey =
          (await backend.getApiKey?.(provider)) ?? config.apiKey;
        const title = await generateThreadTitle(provider, apiKey, messageText);
        if (title) await backend.updateThreadTitle(threadId, title);
      })().catch(err => console.error("[chat] Title generation error:", err));
    }

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

    // Fallback factory — stream-mapper invokes this if primary send() throws
    // before any content is emitted, or if the 3× empty-retry loop exhausts.
    // Requires both a configured fallback provider and a backend that supports
    // switching (backends opt in via `createFallbackConversation`).
    const createFallback =
      config.fallbackProvider && backend.createFallbackConversation
        ? () =>
            backend.createFallbackConversation!(
              threadId,
              config.fallbackProvider!,
              config.fallbackModel,
            )
        : undefined;

    const stream = createSseStream(conversation, finalMessage, {
      fileIds: fileIds.length > 0 ? fileIds : undefined,
      images: images.length > 0 ? images : undefined,
      threadId,
      traceFile,
      apiBasePath: config.apiBasePath,
      deferToolOutput: config.provider === "openai",
      backgroundTask: titleTask,
      createFallback,
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
