/**
 * Maps SDK Conversation.send() streaming events to the assistant-ui
 * UIMessageStream SSE v1 wire protocol.
 *
 * Wire protocol tool event types (from Vercel AI SDK docs):
 *   tool-input-start     → { toolCallId, toolName }
 *   tool-input-delta     → { toolCallId, inputTextDelta }
 *   tool-input-available → { toolCallId, toolName, input: object }
 *   tool-output-available→ { toolCallId, output: JSONValue }
 *
 * Single export: createSseStream(conversation, message, fileIds?) → ReadableStream
 */

import type { Conversation } from "ucl-study-llm-chat-api";
import type { StreamEvent } from "ucl-study-llm-chat-api";
import { readFileSync, mkdirSync, rmSync, copyFileSync } from "fs";
import { join, extname } from "path";
import os from "os";
import crypto from "crypto";

const FILES_DIR = join(process.cwd(), "data/files");
mkdirSync(FILES_DIR, { recursive: true });

const encoder = new TextEncoder();

function sseBytes(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

/** Try to parse a string as JSON; if it fails, wrap it in an object. */
function parseToolInput(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) return parsed;
    return { value: parsed };
  } catch {
    return { code: raw };
  }
}

/** Parse output as JSON value, or return as-is string. */
function parseToolOutput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Creates a ReadableStream that emits assistant-ui v1 SSE events
 * by calling conversation.send() and mapping each SDK StreamEvent.
 */
export function createSseStream(
  conversation: Conversation,
  message: string,
  fileIds?: string[],
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      // State machine
      let textBlockOpen = false;
      let textBlockCounter = 0;
      let toolCallCounter = 0;
      let accumulatedInput = "";
      let accumulatedOutput = "";
      let toolInputFinalized = false;
      let currentToolName = "";
      let streamClosed = false;

      /** Safe enqueue — guards against closed controller */
      function emit(data: Record<string, unknown>) {
        if (streamClosed) return;
        try {
          controller.enqueue(sseBytes(data));
        } catch {
          streamClosed = true;
        }
      }

      function currentTextId() {
        return `text-${textBlockCounter}`;
      }

      function currentToolCallId() {
        return `tool-${toolCallCounter}`;
      }

      function openTextBlock() {
        if (!textBlockOpen) {
          emit({ type: "text-start", id: currentTextId() });
          textBlockOpen = true;
        }
      }

      function closeTextBlock() {
        if (textBlockOpen) {
          emit({ type: "text-end", id: currentTextId() });
          textBlockOpen = false;
          textBlockCounter++;
        }
      }

      emit({ type: "start" });

      try {
        const sendOptions = fileIds?.length ? { fileIds } : undefined;
        const result = await conversation.send(message, (event: StreamEvent) => {
          // Debug: log every SDK event
          const logEvent = { ...event } as Record<string, unknown>;
          if (logEvent.text && typeof logEvent.text === "string" && logEvent.text.length > 80) {
            logEvent.text = logEvent.text.slice(0, 80) + "...";
          }
          if (logEvent.code && typeof logEvent.code === "string" && logEvent.code.length > 80) {
            logEvent.code = logEvent.code.slice(0, 80) + "...";
          }
          if (logEvent.output && typeof logEvent.output === "string" && logEvent.output.length > 80) {
            logEvent.output = logEvent.output.slice(0, 80) + "...";
          }
          console.log("[stream-mapper] event:", JSON.stringify(logEvent));

          switch (event.type) {
            case "text": {
              const txt = event.text ?? "";
              // Filter out internal SDK/API debug messages
              if (/^File .+ is now available in the current working directory/i.test(txt.trim())) {
                break;
              }
              openTextBlock();
              emit({
                type: "text-delta",
                id: currentTextId(),
                delta: txt,
              });
              break;
            }

            case "tool_start": {
              closeTextBlock();
              currentToolName = event.toolName ?? "code_execution";
              emit({
                type: "tool-input-start",
                toolCallId: currentToolCallId(),
                toolName: currentToolName,
              });
              accumulatedInput = "";
              accumulatedOutput = "";
              toolInputFinalized = false;
              break;
            }

            case "tool_input": {
              const delta = event.text ?? "";
              emit({
                type: "tool-input-delta",
                toolCallId: currentToolCallId(),
                inputTextDelta: delta,
              });
              accumulatedInput += delta;
              break;
            }

            case "code": {
              const delta = event.code ?? "";
              emit({
                type: "tool-input-delta",
                toolCallId: currentToolCallId(),
                inputTextDelta: delta,
              });
              accumulatedInput += delta;
              break;
            }

            case "code_executing": {
              // Finalize input — but only if we actually have input accumulated.
              // OpenAI sends code_executing BEFORE the code events, so we skip
              // finalization here if input is empty and let code_complete handle it.
              if (!toolInputFinalized && accumulatedInput) {
                emit({
                  type: "tool-input-available",
                  toolCallId: currentToolCallId(),
                  toolName: currentToolName,
                  input: parseToolInput(accumulatedInput),
                });
                toolInputFinalized = true;
              }
              break;
            }

            case "code_output": {
              accumulatedOutput += event.output ?? "";
              break;
            }

            case "code_complete": {
              if (!toolInputFinalized) {
                emit({
                  type: "tool-input-available",
                  toolCallId: currentToolCallId(),
                  toolName: currentToolName,
                  input: parseToolInput(accumulatedInput),
                });
                toolInputFinalized = true;
              }
              break;
            }

            case "tool_end": {
              // Finalize input if not done yet
              if (!toolInputFinalized) {
                emit({
                  type: "tool-input-available",
                  toolCallId: currentToolCallId(),
                  toolName: currentToolName,
                  input: parseToolInput(accumulatedInput),
                });
                toolInputFinalized = true;
              }
              // Accumulate any final output
              if (event.output) {
                accumulatedOutput += event.output;
              }
              // Emit output only if there's actual content
              const outputVal = accumulatedOutput
                ? parseToolOutput(accumulatedOutput)
                : "Execution complete";
              emit({
                type: "tool-output-available",
                toolCallId: currentToolCallId(),
                output: outputVal,
              });
              toolCallCounter++;
              accumulatedInput = "";
              accumulatedOutput = "";
              toolInputFinalized = false;
              break;
            }
          }
        }, sendOptions);

        console.log("[stream-mapper] send() completed. text length:", result?.text?.length ?? 0, "files:", result?.files?.length ?? 0, "codeArtifacts:", result?.codeArtifacts?.length ?? 0);

        // Clean up trailing open text block
        closeTextBlock();

        // Emit generated files as markdown images served via /api/files/
        if (result?.files?.length) {
          let tmpDir: string | undefined;
          try {
            tmpDir = join(os.tmpdir(), `chat-files-${Date.now()}`);
            mkdirSync(tmpDir, { recursive: true });
            const paths = await conversation.downloadFiles(result.files, tmpDir);

            // Deduplicate by content hash and separate images from text files
            const seenHashes = new Set<string>();
            const imageFiles: Array<{ id: string; filename: string }> = [];
            const textFiles: Array<{ id: string; filename: string }> = [];

            for (let i = 0; i < paths.length; i++) {
              const downloadedPath = paths[i];
              const file = result.files[i];
              const content = readFileSync(downloadedPath);

              // Deduplicate by SHA-256 hash
              const hash = crypto.createHash("sha256").update(content).digest("hex");
              if (seenHashes.has(hash)) {
                console.log(`[stream-mapper] Skipping duplicate: ${file.filename}`);
                continue;
              }
              seenHashes.add(hash);

              // Determine actual file type from magic bytes
              const isPng = content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4E && content[3] === 0x47;
              const isJpeg = content[0] === 0xFF && content[1] === 0xD8;
              const isImage = isPng || isJpeg;

              // Save with correct extension
              const origExt = extname(file.filename || ".png") || ".png";
              const ext = isImage ? origExt : ".txt";
              const id = crypto.randomUUID() + ext;
              copyFileSync(downloadedPath, join(FILES_DIR, id));

              const rawName = file.filename || `Generated file ${i + 1}`;
              // Fix displayed name for text files (SDK labels them .png)
              const filename = isImage ? rawName : rawName.replace(/\.\w+$/, ".txt");
              if (isImage) {
                imageFiles.push({ id, filename });
              } else {
                textFiles.push({ id, filename });
              }
            }

            if (imageFiles.length > 0 || textFiles.length > 0) {
              openTextBlock();
              for (const img of imageFiles) {
                emit({
                  type: "text-delta",
                  id: currentTextId(),
                  delta: `\n\n![${img.filename}](/api/files/${img.id})\n\n`,
                });
              }
              for (const tf of textFiles) {
                emit({
                  type: "text-delta",
                  id: currentTextId(),
                  delta: `\n\n[${tf.filename}](/api/files/${tf.id})\n\n`,
                });
              }
              closeTextBlock();
            }
          } catch (fileErr) {
            console.error("[stream-mapper] Error downloading files:", fileErr);
          } finally {
            if (tmpDir) {
              try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
            }
          }
        }

        emit({ type: "finish" });
      } catch (err) {
        console.error("[stream-mapper] Stream error:", err);
        closeTextBlock();
        const errorMsg = err instanceof Error
          ? `${err.message}${err.cause ? `\nCause: ${err.cause}` : ""}`
          : String(err);
        emit({ type: "error", errorText: errorMsg });
      } finally {
        if (!streamClosed) {
          try { controller.close(); } catch {}
        }
      }
    },
  });
}
