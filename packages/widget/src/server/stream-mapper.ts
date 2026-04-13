/**
 * Maps SDK Conversation.send() streaming events to the assistant-ui
 * UIMessageStream SSE v1 wire protocol.
 *
 * Wire protocol tool event types (from Vercel AI SDK docs):
 *   tool-input-start     -> { toolCallId, toolName }
 *   tool-input-delta     -> { toolCallId, inputTextDelta }
 *   tool-input-available -> { toolCallId, toolName, input: object }
 *   tool-output-available-> { toolCallId, output: JSONValue }
 *
 * Single export: createSseStream(conversation, message, options?) -> ReadableStream
 */

import type { Conversation } from "ucl-study-llm-chat-api";
import type { StreamEvent } from "ucl-study-llm-chat-api";
import { appendFileSync } from "fs";
import crypto from "crypto";

/** Enable verbose per-event logging with DEBUG_STREAMS=1 */
const DEBUG_STREAMS = !!process.env.DEBUG_STREAMS;

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

export interface SseStreamOptions {
  fileIds?: string[];
  /** Images to embed as visual content in the LLM prompt. */
  images?: Array<{ base64Data: string; mediaType: string }>;
  /** Thread ID for constructing file URLs. */
  threadId: string;
  /** When set, append JSONL trace entries to this file path. */
  traceFile?: string;
  /** API route base path for constructing artifact URLs (default: "/api"). */
  apiBasePath?: string;
  /** When true, defer tool output emission until code_output arrives post-stream.
   *  Set to true for OpenAI where outputs arrive after the stream ends.
   *  Default: false (Claude/Gemini send output between tool_end and next event). */
  deferToolOutput?: boolean;
}

/**
 * Creates a ReadableStream that emits assistant-ui v1 SSE events
 * by calling conversation.send() and mapping each SDK StreamEvent.
 */
export function createSseStream(
  conversation: Conversation,
  message: string,
  options: SseStreamOptions,
): ReadableStream {
  const { fileIds, images, threadId, traceFile, apiBasePath, deferToolOutput } = options;
  const baseUrl = apiBasePath ?? "/api";

  /** Append a JSONL trace entry if traceFile is set. */
  function traceLog(layer: string, type: string, data: Record<string, unknown>) {
    if (!traceFile) return;
    try {
      appendFileSync(traceFile, JSON.stringify({ ts: new Date().toISOString(), layer, type, data }) + "\n");
    } catch { /* best-effort */ }
  }

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
      let currentSdkToolId: string | undefined; // SDK-side tool ID (Claude)
      let pendingToolEnd = false; // tool_end fired but output not yet emitted
      let currentlyInTool = false; // between tool_start and tool_end
      let streamedTextLength = 0; // total chars streamed via text events
      let streamClosed = false;
      /** Tools that were flushed (counter advanced) before their output arrived.
       *  Each entry holds the toolCallId to emit output-available for later. */
      const deferredOutputTools: Array<{ toolCallId: string; sdkToolId?: string }> = [];
      /** Maps SDK tool IDs (from provider) to SSE tool IDs (tool-0, tool-1, ...). */
      const sdkToSseToolId = new Map<string, string>();

      /** Safe enqueue — guards against closed controller */
      function emit(data: Record<string, unknown>) {
        if (streamClosed) return;
        traceLog("sse", String(data.type ?? "unknown"), data);
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

      /** Flush a pending tool.
       *
       *  If real output is available, emit tool-output-available immediately.
       *
       *  If no output:
       *  - deferToolOutput=true (OpenAI): push to deferred queue — the
       *    code_output will arrive post-stream and be matched FIFO.
       *  - deferToolOutput=false (Claude/Gemini): emit "Execution complete"
       *    immediately. Claude sends code_output between tool_end and
       *    the next event, so tools without output (e.g. text_editor)
       *    genuinely have no output to wait for. */
      function flushPendingTool() {
        if (!pendingToolEnd) return;
        if (accumulatedOutput) {
          emit({
            type: "tool-output-available",
            toolCallId: currentToolCallId(),
            output: parseToolOutput(accumulatedOutput),
          });
        } else if (deferToolOutput) {
          deferredOutputTools.push({ toolCallId: currentToolCallId() });
        } else {
          emit({
            type: "tool-output-available",
            toolCallId: currentToolCallId(),
            output: "Execution complete",
          });
        }
        toolCallCounter++;
        accumulatedInput = "";
        accumulatedOutput = "";
        toolInputFinalized = false;
        pendingToolEnd = false;
      }

      emit({ type: "start" });

      const sendOptions: Record<string, unknown> = {};
      if (fileIds?.length) sendOptions.fileIds = fileIds;
      if (images?.length) sendOptions.images = images;
      if (traceFile) sendOptions.traceFile = traceFile;
      const hasSendOptions = Object.keys(sendOptions).length > 0;

      console.log(`[stream-mapper] send() starting — threadId=${threadId} msgLen=${message.length} files=${fileIds?.length ?? 0} images=${images?.length ?? 0}`);

      const MAX_ATTEMPTS = 3;
      let attempt = 0;

      try {
        let result: any;

        while (attempt < MAX_ATTEMPTS) {
          attempt++;

          // Reset counters for each attempt
          if (attempt > 1) {
            textBlockOpen = false;
            textBlockCounter = 0;
            toolCallCounter = 0;
            accumulatedInput = "";
            accumulatedOutput = "";
            toolInputFinalized = false;
            currentToolName = "";
            currentSdkToolId = undefined;
            pendingToolEnd = false;
            currentlyInTool = false;
            streamedTextLength = 0;
            deferredOutputTools.length = 0;
            sdkToSseToolId.clear();
          }

        result = await conversation.send(message, (event: StreamEvent) => {
          // Debug: log every SDK event (enable with DEBUG_STREAMS=1)
          if (DEBUG_STREAMS) {
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
          }
          traceLog("sdk", event.type, { type: event.type } as Record<string, unknown>);

          switch (event.type) {
            case "text": {
              flushPendingTool();
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
              streamedTextLength += txt.length;
              break;
            }

            case "tool_start": {
              flushPendingTool();
              closeTextBlock();
              currentlyInTool = true;
              currentToolName = event.toolName ?? "code_execution";
              currentSdkToolId = event.toolCallId;
              // Track SDK tool ID → SSE tool ID mapping
              if (event.toolCallId) {
                sdkToSseToolId.set(event.toolCallId, currentToolCallId());
              }
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
              const outputText = event.output ?? "";
              if (currentlyInTool) {
                // Output for the current tool (between tool_start and tool_end).
                accumulatedOutput += outputText;
              } else if (event.toolCallId && sdkToSseToolId.has(event.toolCallId)) {
                // Claude pattern: code_output has a toolCallId linking it to
                // its originating tool. Emit directly to the correct tool,
                // bypassing the FIFO queue which can't handle out-of-order results.
                const sseToolId = sdkToSseToolId.get(event.toolCallId)!;
                // Remove from deferred queue if it was deferred
                const deferredIdx = deferredOutputTools.findIndex(d => d.toolCallId === sseToolId);
                if (deferredIdx !== -1) {
                  deferredOutputTools.splice(deferredIdx, 1);
                }
                // If this output is for the tool that just ended (pendingToolEnd),
                // clear pendingToolEnd so flushPendingTool doesn't emit a duplicate
                if (pendingToolEnd && sseToolId === currentToolCallId()) {
                  pendingToolEnd = false;
                  toolCallCounter++;
                  accumulatedInput = "";
                  accumulatedOutput = "";
                  toolInputFinalized = false;
                }
                emit({
                  type: "tool-output-available",
                  toolCallId: sseToolId,
                  output: outputText ? parseToolOutput(outputText) : "Execution complete",
                });
              } else if (deferredOutputTools.length > 0) {
                // OpenAI pattern: no toolCallId, use FIFO queue.
                const deferred = deferredOutputTools.shift()!;
                emit({
                  type: "tool-output-available",
                  toolCallId: deferred.toolCallId,
                  output: outputText ? parseToolOutput(outputText) : "Execution complete",
                });
              } else if (pendingToolEnd) {
                // Output after tool_end but before next event flushes it.
                accumulatedOutput += outputText;
              }
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
              currentlyInTool = false;
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
              // Always mark tool as ended. If we already have output
              // (OpenAI/Gemini send code_output before tool_end), flush now.
              // Otherwise defer — Claude sends code_output after tool_end.
              pendingToolEnd = true;
              if (accumulatedOutput) {
                flushPendingTool();
              }
              break;
            }
          }
        }, hasSendOptions ? sendOptions : undefined);

        console.log(`[stream-mapper] send() completed (attempt ${attempt}/${MAX_ATTEMPTS}) — text=${result?.text?.length ?? 0} files=${result?.files?.length ?? 0} artifacts=${result?.codeArtifacts?.length ?? 0} streamedText=${streamedTextLength} tools=${toolCallCounter}`);
        traceLog("sdk", "SEND_RESULT", {
          attempt,
          textLength: result?.text?.length ?? 0,
          filesCount: result?.files?.length ?? 0,
          codeArtifactsCount: result?.codeArtifacts?.length ?? 0,
          streamedTextLength,
          toolCallCounter,
        });

        // Check if we got any content
        if (streamedTextLength > 0 || toolCallCounter > 0) {
          break; // Got content, exit retry loop
        }

        // Empty response — retry if we have attempts left
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[stream-mapper] Empty response on attempt ${attempt}/${MAX_ATTEMPTS}, retrying in 3s...`);
          emit({ type: "error", errorText: `Empty response from model, retrying (${attempt}/${MAX_ATTEMPTS})...` });
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        // All attempts exhausted
        console.error(`[stream-mapper] Empty response after ${MAX_ATTEMPTS} attempts`);
        emit({ type: "error", errorText: `The model returned empty responses after ${MAX_ATTEMPTS} attempts. Please try again.` });

        } // end retry while loop

        // Flush any pending tool output
        flushPendingTool();

        // Emit placeholder for any deferred tools that never got code_output
        for (const deferred of deferredOutputTools) {
          emit({
            type: "tool-output-available",
            toolCallId: deferred.toolCallId,
            output: "Execution complete",
          });
        }
        deferredOutputTools.length = 0;

        // Safety net: if SDK captured more text than we streamed
        // (e.g. post-tool text missed during streaming), emit the tail
        if (result?.text && result.text.length > streamedTextLength) {
          const missedText = result.text.slice(streamedTextLength);
          if (missedText.trim()) {
            openTextBlock();
            emit({
              type: "text-delta",
              id: currentTextId(),
              delta: missedText,
            });
          }
        }

        closeTextBlock();

        // Emit generated files — images as inline data URIs, others as artifact links
        // Emit generated files as links served via /api/threads/{id}/files/{fileId}
        // The files route reads base64Data from the stored conversation — works on serverless.
        if (result?.files?.length) {
          const seenHashes = new Set<string>();
          let hasInlineContent = false;

          for (const file of result.files) {
            // Deduplicate
            const hashInput = file.base64Data || file.file_id || file.filename;
            if (hashInput) {
              const hash = crypto.createHash("sha256").update(hashInput).digest("hex");
              if (seenHashes.has(hash)) continue;
              seenHashes.add(hash);
            }

            const fileId = file.file_id;
            const mimeType = file.mimeType || "image/png";
            const isImage = mimeType.startsWith("image/");
            const name = file.filename || `output.${isImage ? "png" : "txt"}`;
            const url = `${baseUrl}/threads/${threadId}/files/${fileId}`;

            if (!hasInlineContent) { openTextBlock(); hasInlineContent = true; }

            if (isImage) {
              emit({
                type: "text-delta",
                id: currentTextId(),
                delta: `\n\n![${name}](${url})\n\n`,
              });
            } else {
              emit({
                type: "text-delta",
                id: currentTextId(),
                delta: `\n\n[${name}](${url})\n\n`,
              });
            }
          }

          if (hasInlineContent) closeTextBlock();
        }

        emit({ type: "finish" });
      } catch (err) {
        console.error(`[stream-mapper] Stream error — threadId=${threadId} attempt=${attempt}:`, err);
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
