/**
 * Chat API route — streams responses using the ucl-study-llm-chat-api SDK.
 *
 * Provider selected via CHAT_PROVIDER env var:
 *   "anthropic" (default) | "openai" | "gemini"
 *
 * Imports client creation from the SDK and bridges the provider-native
 * streams to the assistant-ui v1 SSE message protocol.
 */

import {
  createAnthropicClient,
  createOpenAIClient,
  createGeminiClient,
  type ConversationMessage,
} from "ucl-study-llm-chat-api";

type Provider = "anthropic" | "openai" | "gemini";

function getProvider(): Provider {
  const p = process.env.CHAT_PROVIDER?.toLowerCase();
  if (p === "openai") return "openai";
  if (p === "gemini") return "gemini";
  return "anthropic";
}

// ---------------------------------------------------------------------------
// UIMessage → provider message conversion
// ---------------------------------------------------------------------------

interface UIMessage {
  role: string;
  content?: string;
  parts?: Array<{ type: string; text?: string }>;
}

function toConversationMessages(messages: UIMessage[]): ConversationMessage[] {
  return messages.map((m) => {
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.parts)) {
      text = m.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!)
        .join("");
    }
    return {
      role: m.role === "assistant" ? "assistant" : "user",
      content: text,
    } as ConversationMessage;
  });
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
function sse(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// Anthropic streaming
// ---------------------------------------------------------------------------

function streamAnthropic(messages: ConversationMessage[]): ReadableStream {
  const client = createAnthropicClient();
  const anthropicMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return new ReadableStream({
    async start(controller) {
      controller.enqueue(sse({ type: "start" }));
      let textId = "text-0";
      let textStarted = false;

      try {
        const stream = client.messages.stream({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929",
          max_tokens: 8192,
          messages: anthropicMessages,
        });

        for await (const event of stream) {
          if (event.type === "content_block_start") {
            const block = (event as any).content_block;
            if (block?.type === "text" && !textStarted) {
              controller.enqueue(sse({ type: "text-start", id: textId }));
              textStarted = true;
            }
          } else if (event.type === "content_block_delta") {
            const delta = (event as any).delta;
            if (delta?.type === "text_delta" && delta.text) {
              if (!textStarted) {
                controller.enqueue(sse({ type: "text-start", id: textId }));
                textStarted = true;
              }
              controller.enqueue(
                sse({ type: "text-delta", id: textId, delta: delta.text })
              );
            }
          } else if (event.type === "content_block_stop") {
            if (textStarted) {
              controller.enqueue(sse({ type: "text-end", id: textId }));
              textStarted = false;
              textId = `text-${parseInt(textId.split("-")[1]) + 1}`;
            }
          }
        }

        if (textStarted) {
          controller.enqueue(sse({ type: "text-end", id: textId }));
        }
        controller.enqueue(sse({ type: "finish" }));
      } catch (err) {
        controller.enqueue(
          sse({ type: "error", error: String(err) })
        );
      } finally {
        controller.close();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// OpenAI streaming
// ---------------------------------------------------------------------------

function streamOpenAI(messages: ConversationMessage[]): ReadableStream {
  const client = createOpenAIClient();
  const openaiMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return new ReadableStream({
    async start(controller) {
      controller.enqueue(sse({ type: "start" }));
      const textId = "text-0";
      let textStarted = false;

      try {
        const stream = await client.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o",
          messages: openaiMessages,
          stream: true,
        });

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            if (!textStarted) {
              controller.enqueue(sse({ type: "text-start", id: textId }));
              textStarted = true;
            }
            controller.enqueue(
              sse({ type: "text-delta", id: textId, delta: content })
            );
          }
        }

        if (textStarted) {
          controller.enqueue(sse({ type: "text-end", id: textId }));
        }
        controller.enqueue(sse({ type: "finish" }));
      } catch (err) {
        controller.enqueue(
          sse({ type: "error", error: String(err) })
        );
      } finally {
        controller.close();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Gemini streaming
// ---------------------------------------------------------------------------

function streamGemini(messages: ConversationMessage[]): ReadableStream {
  const client = createGeminiClient();

  // Convert to Gemini contents format (role: "user" | "model")
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  return new ReadableStream({
    async start(controller) {
      controller.enqueue(sse({ type: "start" }));
      const textId = "text-0";
      let textStarted = false;

      try {
        const stream = await client.models.generateContentStream({
          model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
          contents,
        });

        for await (const chunk of stream) {
          const text = chunk.candidates?.[0]?.content?.parts
            ?.filter((p: any) => p.text)
            .map((p: any) => p.text)
            .join("");
          if (text) {
            if (!textStarted) {
              controller.enqueue(sse({ type: "text-start", id: textId }));
              textStarted = true;
            }
            controller.enqueue(
              sse({ type: "text-delta", id: textId, delta: text })
            );
          }
        }

        if (textStarted) {
          controller.enqueue(sse({ type: "text-end", id: textId }));
        }
        controller.enqueue(sse({ type: "finish" }));
      } catch (err) {
        controller.enqueue(
          sse({ type: "error", error: String(err) })
        );
      } finally {
        controller.close();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: UIMessage[] };
  const history = toConversationMessages(messages);
  const provider = getProvider();

  let body: ReadableStream;
  if (provider === "openai") {
    body = streamOpenAI(history);
  } else if (provider === "gemini") {
    body = streamGemini(history);
  } else {
    body = streamAnthropic(history);
  }

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}
