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

/** Default options for createSseStream in tests. */
const testOptions = {
  artifactsDir: "/tmp/test-artifacts",
  threadId: "test-123",
};

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
    const stream = createSseStream(conv, "Hi", testOptions);
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
    const stream = createSseStream(conv, "What is 2+2?", testOptions);
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
    const stream = createSseStream(conv, "run", testOptions);
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
    const stream = createSseStream(conv, "run code", testOptions);
    const sse = await collectSseEvents(stream);

    const toolStarts = sse.filter((e) => e.type === "tool-input-start");
    expect(toolStarts[0]).toMatchObject({ toolCallId: "tool-0" });
    expect(toolStarts[1]).toMatchObject({ toolCallId: "tool-1" });
  });

  it("emits only start → finish for empty response", async () => {
    const conv = mockConversation([]);
    const stream = createSseStream(conv, "Hello", testOptions);
    const sse = await collectSseEvents(stream);

    expect(sse).toEqual([{ type: "start" }, { type: "finish" }]);
  });

  it("emits error event when send() throws", async () => {
    const conv = errorConversation(new Error("API failure"));
    const stream = createSseStream(conv, "Hello", testOptions);
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
    const stream = createSseStream(conv, "run", testOptions);
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
    const stream = createSseStream(conv, "sqrt 16", testOptions);
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

  // -------------------------------------------------------------------------
  // OpenAI multi-tool-call tests
  // -------------------------------------------------------------------------

  it("OpenAI deferred output — 2 tools with text between", async () => {
    // Simulates exact OpenAI event order: code_output arrives after all
    // tool_end events (post-stream deferred pattern).
    const events: StreamEvent[] = [
      // Tool 0: factorial
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "result = 1\nfor i in range(1,11): result *= i\nprint(result)" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Text between tools
      { type: "text", text: "Let me also compute the Fibonacci sequence." },
      // Tool 1: fibonacci
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "fib = [0,1]\nfor i in range(13): fib.append(fib[-1]+fib[-2])\nprint(fib)" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Post-stream deferred outputs (FIFO order matches tool order)
      { type: "code_output", output: "3628800" },
      { type: "code_output", output: "0,1,1,2,3,5,8,13,21,34,55,89,144,233,377" },
      // Final text
      { type: "text", text: "In summary, 10! = 3628800 and the first 15 Fibonacci numbers are listed above." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "compute", testOptions);
    const sse = await collectSseEvents(stream);

    const types = sse.map((e) => e.type);

    // Both tools have input-start
    const toolStarts = sse.filter((e) => e.type === "tool-input-start");
    expect(toolStarts).toHaveLength(2);
    expect(toolStarts[0]).toMatchObject({ toolCallId: "tool-0", toolName: "code_interpreter" });
    expect(toolStarts[1]).toMatchObject({ toolCallId: "tool-1", toolName: "code_interpreter" });

    // Both tools have output-available with real output (not "Execution complete")
    const toolOutputs = sse.filter((e) => e.type === "tool-output-available");
    expect(toolOutputs).toHaveLength(2);
    expect(toolOutputs[0]).toMatchObject({ toolCallId: "tool-0", output: 3628800 });
    expect(toolOutputs[1]).toMatchObject({ toolCallId: "tool-1" });
    expect(toolOutputs[1].output).not.toBe("Execution complete");
    expect(String(toolOutputs[1].output)).toContain("0,1,1,2,3");

    // Text events exist
    expect(sse.some((e) => e.type === "text-delta")).toBe(true);

    // Ends with finish, no errors
    expect(sse[sse.length - 1]).toEqual({ type: "finish" });
    expect(types).not.toContain("error");
  });

  it("OpenAI inline output — code_output before tool_end", async () => {
    // Simulates when SDK extracts output from the `completed` streaming
    // event and emits code_output before tool_end.
    const events: StreamEvent[] = [
      // Tool 0: factorial (inline output)
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "result = 1\nfor i in range(1,11): result *= i\nprint(result)" },
      { type: "code_complete" },
      { type: "code_output", output: "3628800" },
      { type: "tool_end" },
      // Text between
      { type: "text", text: "Now for Fibonacci." },
      // Tool 1: fibonacci (inline output)
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "fib = [0,1]\nfor i in range(13): fib.append(fib[-1]+fib[-2])\nprint(fib)" },
      { type: "code_complete" },
      { type: "code_output", output: "[0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377]" },
      { type: "tool_end" },
      // Final text
      { type: "text", text: "Both computations are complete." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "compute", testOptions);
    const sse = await collectSseEvents(stream);

    const types = sse.map((e) => e.type);

    // Both tools get real output
    const toolOutputs = sse.filter((e) => e.type === "tool-output-available");
    expect(toolOutputs).toHaveLength(2);
    expect(toolOutputs[0]).toMatchObject({ toolCallId: "tool-0", output: 3628800 });
    expect(toolOutputs[1]).toMatchObject({ toolCallId: "tool-1" });
    expect(toolOutputs[1].output).not.toBe("Execution complete");

    // IDs match between input-start and output-available
    const toolInputStarts = sse.filter((e) => e.type === "tool-input-start");
    expect(toolInputStarts[0].toolCallId).toBe(toolOutputs[0].toolCallId);
    expect(toolInputStarts[1].toolCallId).toBe(toolOutputs[1].toolCallId);

    // Ends with finish, no errors
    expect(sse[sse.length - 1]).toEqual({ type: "finish" });
    expect(types).not.toContain("error");
  });

  it("OpenAI mixed — tool-0 deferred, tool-1 inline", async () => {
    // Tool-0 output arrives post-stream (deferred), tool-1 output arrives
    // inline (before tool_end). Tests that inline output goes to the
    // correct tool even when the deferred queue has entries.
    const events: StreamEvent[] = [
      // Tool 0: factorial (no inline output — deferred)
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print(3628800)" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Tool 1: fibonacci (inline output)
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print([0,1,1,2,3,5,8,13])" },
      { type: "code_complete" },
      { type: "code_output", output: "[0, 1, 1, 2, 3, 5, 8, 13]" },
      { type: "tool_end" },
      // Post-stream deferred output for tool-0
      { type: "code_output", output: "3628800" },
      // Final text
      { type: "text", text: "Done." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "compute", testOptions);
    const sse = await collectSseEvents(stream);

    const types = sse.map((e) => e.type);

    // Both tools get real output
    const toolOutputs = sse.filter((e) => e.type === "tool-output-available");
    expect(toolOutputs).toHaveLength(2);

    // Tool-1 inline output is emitted first (at its tool_end)
    expect(toolOutputs[0]).toMatchObject({ toolCallId: "tool-1" });
    expect(toolOutputs[0].output).not.toBe("Execution complete");

    // Tool-0 deferred output is emitted second (at post-stream code_output)
    expect(toolOutputs[1]).toMatchObject({ toolCallId: "tool-0", output: 3628800 });

    // No errors
    expect(sse[sse.length - 1]).toEqual({ type: "finish" });
    expect(types).not.toContain("error");
  });

  it("3 tools, all deferred, no text between tools", async () => {
    const events: StreamEvent[] = [
      // Tool 0
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print('out-0')" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Tool 1
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print('out-1')" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Tool 2
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print('out-2')" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Post-stream deferred outputs (FIFO order)
      { type: "code_output", output: "out-0" },
      { type: "code_output", output: "out-1" },
      { type: "code_output", output: "out-2" },
      // Final text
      { type: "text", text: "All three computations are done." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "compute", testOptions);
    const sse = await collectSseEvents(stream);

    const types = sse.map((e) => e.type);

    // All 3 tools have input-start and output-available
    const toolStarts = sse.filter((e) => e.type === "tool-input-start");
    expect(toolStarts).toHaveLength(3);
    expect(toolStarts[0]).toMatchObject({ toolCallId: "tool-0" });
    expect(toolStarts[1]).toMatchObject({ toolCallId: "tool-1" });
    expect(toolStarts[2]).toMatchObject({ toolCallId: "tool-2" });

    const toolOutputs = sse.filter((e) => e.type === "tool-output-available");
    expect(toolOutputs).toHaveLength(3);

    // All get real output with correct IDs
    expect(toolOutputs[0]).toMatchObject({ toolCallId: "tool-0", output: "out-0" });
    expect(toolOutputs[1]).toMatchObject({ toolCallId: "tool-1", output: "out-1" });
    expect(toolOutputs[2]).toMatchObject({ toolCallId: "tool-2", output: "out-2" });

    // None have "Execution complete" placeholder
    for (const out of toolOutputs) {
      expect(out.output).not.toBe("Execution complete");
    }

    // Ends correctly
    expect(sse[sse.length - 1]).toEqual({ type: "finish" });
    expect(types).not.toContain("error");
  });
});
