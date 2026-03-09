/**
 * Unit tests for the SSE stream mapper.
 *
 * Uses a mock Conversation whose send() fires a predefined sequence
 * of StreamEvent objects to the callback.
 */

import { describe, it, expect } from "vitest";
import { createSseStream } from "@/app/api/chat/stream-mapper";
import type { StreamEvent } from "ucl-study-llm-chat-api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reads a ReadableStream and parses the SSE `data: {...}\n\n` lines. */
async function collectSseEvents(
  stream: ReadableStream,
): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Record<string, unknown>[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;
    for (const part of parts) {
      const line = part.trim();
      if (line.startsWith("data: ")) {
        events.push(JSON.parse(line.slice(6)));
      }
    }
  }

  if (buffer.trim().startsWith("data: ")) {
    events.push(JSON.parse(buffer.trim().slice(6)));
  }

  return events;
}

type SendCallback = (event: StreamEvent) => void;

/** Creates a mock Conversation that fires the given events on send(). */
function mockConversation(events: StreamEvent[]) {
  return {
    send: async (_message: string, onEvent: SendCallback) => {
      for (const event of events) {
        onEvent(event);
      }
      return { text: "", files: [], codeArtifacts: [] };
    },
  } as any;
}

/** Creates a mock Conversation whose send() throws. */
function errorConversation(error: Error) {
  return {
    send: async () => {
      throw error;
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSseStream", () => {
  it("streams text-only response correctly", async () => {
    const events: StreamEvent[] = [
      { type: "text", text: "Hello" },
      { type: "text", text: " world" },
      { type: "text", text: "!" },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "Hi");
    const sse = await collectSseEvents(stream);

    expect(sse[0]).toEqual({ type: "start" });
    expect(sse[1]).toEqual({ type: "text-start", id: "text-0" });
    expect(sse[2]).toEqual({ type: "text-delta", id: "text-0", delta: "Hello" });
    expect(sse[3]).toEqual({
      type: "text-delta",
      id: "text-0",
      delta: " world",
    });
    expect(sse[4]).toEqual({ type: "text-delta", id: "text-0", delta: "!" });
    expect(sse[5]).toEqual({ type: "text-end", id: "text-0" });
    expect(sse[6]).toEqual({ type: "finish" });
    expect(sse).toHaveLength(7);
  });

  it("handles text → tool → text interleaving", async () => {
    const events: StreamEvent[] = [
      { type: "text", text: "Let me compute that." },
      { type: "tool_start", toolName: "code_execution" },
      { type: "tool_input", text: '{"command": "python -c \\"print(2+2)\\""}' },
      { type: "code_executing" },
      { type: "code_output", output: "4" },
      { type: "tool_end" },
      { type: "text", text: "The answer is 4." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "What is 2+2?");
    const sse = await collectSseEvents(stream);

    const types = sse.map((e) => e.type);

    expect(types[0]).toBe("start");
    expect(types[1]).toBe("text-start");
    expect(types[2]).toBe("text-delta");
    expect(types[3]).toBe("text-end"); // close text before tool
    expect(types[4]).toBe("tool-input-start");
    expect(types[5]).toBe("tool-input-delta");
    expect(types[6]).toBe("tool-input-available");
    // code_output accumulated, emitted at tool_end
    expect(types[7]).toBe("tool-output-available");
    expect(types[8]).toBe("text-start"); // reopen text
    expect(types[9]).toBe("text-delta");
    expect(types[10]).toBe("text-end");
    expect(types[11]).toBe("finish");

    // Verify tool-input-start fields
    expect(sse[4]).toMatchObject({
      toolCallId: "tool-0",
      toolName: "code_execution",
    });

    // Verify tool-input-available has parsed JSON input
    expect(sse[6]).toMatchObject({
      type: "tool-input-available",
      toolCallId: "tool-0",
      toolName: "code_execution",
    });
    expect(sse[6].input).toEqual({
      command: 'python -c "print(2+2)"',
    });

    // Verify tool-output-available ("4" parses to number 4)
    expect(sse[7]).toMatchObject({
      type: "tool-output-available",
      toolCallId: "tool-0",
      output: 4,
    });

    // Second text block has incremented ID
    expect(sse[8]).toMatchObject({ type: "text-start", id: "text-1" });
  });

  it("emits 'Execution complete' when tool has no output", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_execution" },
      { type: "tool_input", text: '{"code": "x = 1"}' },
      { type: "code_executing" },
      { type: "tool_end" },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "run");
    const sse = await collectSseEvents(stream);

    const outputAvail = sse.find((e) => e.type === "tool-output-available");
    expect(outputAvail).toMatchObject({
      output: "Execution complete",
    });
  });

  it("increments tool call IDs for multiple tool calls", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_execution" },
      { type: "tool_input", text: '{"code": "x = 1"}' },
      { type: "code_executing" },
      { type: "tool_end" },
      { type: "tool_start", toolName: "code_execution" },
      { type: "tool_input", text: '{"code": "x + 1"}' },
      { type: "code_executing" },
      { type: "code_output", output: "2" },
      { type: "tool_end" },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "run code");
    const sse = await collectSseEvents(stream);

    const toolStarts = sse.filter((e) => e.type === "tool-input-start");
    expect(toolStarts[0]).toMatchObject({ toolCallId: "tool-0" });
    expect(toolStarts[1]).toMatchObject({ toolCallId: "tool-1" });
  });

  it("emits only start → finish for empty response", async () => {
    const conv = mockConversation([]);
    const stream = createSseStream(conv, "Hello");
    const sse = await collectSseEvents(stream);

    expect(sse).toEqual([{ type: "start" }, { type: "finish" }]);
  });

  it("emits error event when send() throws", async () => {
    const conv = errorConversation(new Error("API failure"));
    const stream = createSseStream(conv, "Hello");
    const sse = await collectSseEvents(stream);

    expect(sse[0]).toEqual({ type: "start" });
    expect(sse[1]).toMatchObject({ type: "error" });
    expect(String(sse[1].errorText)).toContain("API failure");
  });

  it("synthesizes tool-input-available when no code_executing event", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_execution" },
      { type: "tool_input", text: "print('hi')" },
      { type: "tool_end" },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "run");
    const sse = await collectSseEvents(stream);

    const types = sse.map((e) => e.type);
    expect(types).toContain("tool-input-available");
    expect(types).toContain("tool-output-available");
    const inputAvailIdx = types.indexOf("tool-input-available");
    const outputAvailIdx = types.indexOf("tool-output-available");
    expect(inputAvailIdx).toBeLessThan(outputAvailIdx);

    // Non-JSON input gets wrapped in { code: ... }
    expect(sse[inputAvailIdx]).toMatchObject({
      input: { code: "print('hi')" },
    });
  });

  it("handles code events (OpenAI style)", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "import math\n" },
      { type: "code", code: "math.sqrt(16)" },
      { type: "code_executing" },
      { type: "code_output", output: "4.0" },
      { type: "tool_end" },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "sqrt 16");
    const sse = await collectSseEvents(stream);

    // code events should produce tool-input-delta
    const deltas = sse.filter((e) => e.type === "tool-input-delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ inputTextDelta: "import math\n" });
    expect(deltas[1]).toMatchObject({ inputTextDelta: "math.sqrt(16)" });

    // tool-input-available wraps non-JSON in { code: ... }
    const inputAvail = sse.find((e) => e.type === "tool-input-available");
    expect(inputAvail).toMatchObject({
      input: { code: "import math\nmath.sqrt(16)" },
    });

    // tool-output-available has output ("4.0" parses to number 4)
    const outputAvail = sse.find((e) => e.type === "tool-output-available");
    expect(outputAvail).toMatchObject({
      output: 4,
    });
  });
});
