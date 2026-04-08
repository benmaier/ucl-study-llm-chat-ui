/**
 * Stream-mapper SSE state machine tests.
 *
 * Verifies that SDK StreamEvents are correctly mapped to assistant-ui v1 SSE
 * protocol events, especially that tool calls display with results when done.
 */

import { describe, it, expect } from "vitest";
import { createSseStream } from "../server/stream-mapper.js";
import type { StreamEvent } from "ucl-study-llm-chat-api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testOptions = {
  artifactsDir: "/tmp/test-artifacts",
  threadId: "test-123",
};

/** Options for tests that simulate OpenAI's deferred output pattern. */
const openaiOptions = {
  ...testOptions,
  deferToolOutput: true,
};

/** Creates a mock Conversation whose send() invokes the callback with the given events. */
function mockConversation(events: StreamEvent[], result?: Record<string, unknown>) {
  return {
    send: async (_msg: string, onEvent: (e: StreamEvent) => void) => {
      for (const event of events) {
        onEvent(event);
      }
      return result ?? { text: "", files: [], codeArtifacts: [] };
    },
    downloadFiles: async () => [],
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

/** Reads a ReadableStream and parses the SSE `data: {...}\n\n` lines. */
async function collectSseEvents(stream: ReadableStream): Promise<Record<string, unknown>[]> {
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
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSseStream", () => {
  // -----------------------------------------------------------------------
  // Basic text streaming
  // -----------------------------------------------------------------------

  it("text-only response produces start → text-start → text-delta(s) → text-end → finish", async () => {
    const events: StreamEvent[] = [
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
      { type: "text", text: "!" },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "Hi", testOptions);
    const sse = await collectSseEvents(stream);

    expect(sse[0]).toEqual({ type: "start" });
    expect(sse[1]).toEqual({ type: "text-start", id: "text-0" });
    expect(sse[2]).toEqual({ type: "text-delta", id: "text-0", delta: "Hello " });
    expect(sse[3]).toEqual({ type: "text-delta", id: "text-0", delta: "world" });
    expect(sse[4]).toEqual({ type: "text-delta", id: "text-0", delta: "!" });
    expect(sse[5]).toEqual({ type: "text-end", id: "text-0" });
    expect(sse[6]).toEqual({ type: "finish" });
  });

  it("empty response produces start → finish only", async () => {
    const conv = mockConversation([]);
    const stream = createSseStream(conv, "Hello", testOptions);
    const sse = await collectSseEvents(stream);

    expect(sse).toEqual([{ type: "start" }, { type: "finish" }]);
  });

  // -----------------------------------------------------------------------
  // Single tool call — Claude pattern (code_output AFTER tool_end)
  // -----------------------------------------------------------------------

  it("Claude pattern: code_output after tool_end flushes with real output", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print(2+2)" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Claude sends code_output AFTER tool_end
      { type: "code_output", output: "4" },
      { type: "text", text: "The answer is 4." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "What is 2+2?", testOptions);
    const sse = await collectSseEvents(stream);

    const types = sse.map((e) => e.type);

    // Tool lifecycle
    expect(types).toContain("tool-input-start");
    expect(types).toContain("tool-input-delta");
    expect(types).toContain("tool-input-available");
    expect(types).toContain("tool-output-available");

    // Tool output has real value, not placeholder
    const toolOutput = sse.find((e) => e.type === "tool-output-available");
    expect(toolOutput).toMatchObject({ toolCallId: "tool-0", output: 4 });

    // Text after tool
    expect(sse.some((e) => e.type === "text-delta" && e.delta === "The answer is 4.")).toBe(true);

    // Correct ordering: tool events before text
    const toolOutputIdx = sse.findIndex((e) => e.type === "tool-output-available");
    const textDeltaIdx = sse.findIndex((e) => e.type === "text-delta" && e.delta === "The answer is 4.");
    expect(toolOutputIdx).toBeLessThan(textDeltaIdx);

    expect(sse[sse.length - 1]).toEqual({ type: "finish" });
  });

  // -----------------------------------------------------------------------
  // Single tool call — OpenAI inline pattern (code_output BEFORE tool_end)
  // -----------------------------------------------------------------------

  it("OpenAI inline: code_output before tool_end accumulates and flushes at tool_end", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "import math; print(math.sqrt(16))" },
      { type: "code_complete" },
      // OpenAI sends code_output BEFORE tool_end (inline)
      { type: "code_output", output: "4.0" },
      { type: "tool_end" },
      { type: "text", text: "sqrt(16) = 4.0" },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "sqrt 16", testOptions);
    const sse = await collectSseEvents(stream);

    // Tool input shows code
    const inputDeltas = sse.filter((e) => e.type === "tool-input-delta");
    expect(inputDeltas.length).toBeGreaterThan(0);

    // Tool output has real value
    const toolOutput = sse.find((e) => e.type === "tool-output-available");
    expect(toolOutput).toMatchObject({
      toolCallId: "tool-0",
      output: 4.0,
    });

    // No "Execution complete" placeholder
    expect(toolOutput!.output).not.toBe("Execution complete");

    expect(sse[sse.length - 1]).toEqual({ type: "finish" });
  });

  // -----------------------------------------------------------------------
  // Multi-tool — OpenAI deferred output (code_outputs arrive post-stream)
  // -----------------------------------------------------------------------

  it("OpenAI deferred: 2 tools with text between, outputs arrive after all tool_ends", async () => {
    const events: StreamEvent[] = [
      // Tool 0: factorial
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "result = 1\nfor i in range(1,11): result *= i\nprint(result)" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Text between tools
      { type: "text", text: "Now computing Fibonacci." },
      // Tool 1: fibonacci
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "fib = [0,1]\nfor i in range(13): fib.append(fib[-1]+fib[-2])\nprint(fib)" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Post-stream deferred outputs (FIFO order matches tool order)
      { type: "code_output", output: "3628800" },
      { type: "code_output", output: "0,1,1,2,3,5,8,13,21,34,55,89,144,233,377" },
      // Final text
      { type: "text", text: "Both computations complete." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "compute", openaiOptions);
    const sse = await collectSseEvents(stream);

    // Both tools have input-start with correct IDs
    const toolStarts = sse.filter((e) => e.type === "tool-input-start");
    expect(toolStarts).toHaveLength(2);
    expect(toolStarts[0]).toMatchObject({ toolCallId: "tool-0", toolName: "code_interpreter" });
    expect(toolStarts[1]).toMatchObject({ toolCallId: "tool-1", toolName: "code_interpreter" });

    // Both tools have output-available with real output
    const toolOutputs = sse.filter((e) => e.type === "tool-output-available");
    expect(toolOutputs).toHaveLength(2);
    expect(toolOutputs[0]).toMatchObject({ toolCallId: "tool-0", output: 3628800 });
    expect(toolOutputs[1]).toMatchObject({ toolCallId: "tool-1" });
    expect(String(toolOutputs[1].output)).toContain("0,1,1,2,3");

    // Neither has placeholder
    for (const out of toolOutputs) {
      expect(out.output).not.toBe("Execution complete");
    }

    // Text events exist
    expect(sse.some((e) => e.type === "text-delta" && e.delta === "Now computing Fibonacci.")).toBe(true);
    expect(sse.some((e) => e.type === "text-delta" && e.delta === "Both computations complete.")).toBe(true);

    expect(sse[sse.length - 1]).toEqual({ type: "finish" });
  });

  // -----------------------------------------------------------------------
  // Multi-tool — inline output for both
  // -----------------------------------------------------------------------

  it("multi-tool inline: both tools get output before their tool_end", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print(10)" },
      { type: "code_complete" },
      { type: "code_output", output: "10" },
      { type: "tool_end" },
      { type: "text", text: "Next." },
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print(20)" },
      { type: "code_complete" },
      { type: "code_output", output: "20" },
      { type: "tool_end" },
      { type: "text", text: "Done." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "compute", testOptions);
    const sse = await collectSseEvents(stream);

    const toolOutputs = sse.filter((e) => e.type === "tool-output-available");
    expect(toolOutputs).toHaveLength(2);
    expect(toolOutputs[0]).toMatchObject({ toolCallId: "tool-0", output: 10 });
    expect(toolOutputs[1]).toMatchObject({ toolCallId: "tool-1", output: 20 });

    // IDs match between input-start and output-available
    const toolInputStarts = sse.filter((e) => e.type === "tool-input-start");
    expect(toolInputStarts[0].toolCallId).toBe(toolOutputs[0].toolCallId);
    expect(toolInputStarts[1].toolCallId).toBe(toolOutputs[1].toolCallId);

    expect(sse[sse.length - 1]).toEqual({ type: "finish" });
  });

  // -----------------------------------------------------------------------
  // 3 tools, all deferred — FIFO queue ordering
  // -----------------------------------------------------------------------

  it("3 tools, all deferred: FIFO queue matches outputs to correct tool IDs", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print('a')" },
      { type: "code_complete" },
      { type: "tool_end" },
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print('b')" },
      { type: "code_complete" },
      { type: "tool_end" },
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print('c')" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Deferred outputs in order
      { type: "code_output", output: "a" },
      { type: "code_output", output: "b" },
      { type: "code_output", output: "c" },
      { type: "text", text: "All done." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "compute", openaiOptions);
    const sse = await collectSseEvents(stream);

    const toolStarts = sse.filter((e) => e.type === "tool-input-start");
    expect(toolStarts).toHaveLength(3);

    const toolOutputs = sse.filter((e) => e.type === "tool-output-available");
    expect(toolOutputs).toHaveLength(3);
    expect(toolOutputs[0]).toMatchObject({ toolCallId: "tool-0", output: "a" });
    expect(toolOutputs[1]).toMatchObject({ toolCallId: "tool-1", output: "b" });
    expect(toolOutputs[2]).toMatchObject({ toolCallId: "tool-2", output: "c" });

    for (const out of toolOutputs) {
      expect(out.output).not.toBe("Execution complete");
    }
  });

  // -----------------------------------------------------------------------
  // Mixed: tool-0 deferred, tool-1 inline
  // -----------------------------------------------------------------------

  it("mixed: tool-0 deferred, tool-1 inline — both get correct output", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print(1)" },
      { type: "code_complete" },
      { type: "tool_end" },
      // Tool 1 has inline output
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print(2)" },
      { type: "code_complete" },
      { type: "code_output", output: "2" },
      { type: "tool_end" },
      // Deferred output for tool 0
      { type: "code_output", output: "1" },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "compute", openaiOptions);
    const sse = await collectSseEvents(stream);

    const toolOutputs = sse.filter((e) => e.type === "tool-output-available");
    expect(toolOutputs).toHaveLength(2);

    // Tool-1 inline output emitted first (at its tool_end)
    expect(toolOutputs[0]).toMatchObject({ toolCallId: "tool-1" });
    expect(toolOutputs[0].output).not.toBe("Execution complete");

    // Tool-0 deferred output emitted second
    expect(toolOutputs[1]).toMatchObject({ toolCallId: "tool-0", output: 1 });
  });

  // -----------------------------------------------------------------------
  // Tool with no output ever — placeholder emitted
  // -----------------------------------------------------------------------

  it("deferred tool that never gets code_output receives placeholder", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "x = 1" },
      { type: "code_complete" },
      { type: "tool_end" },
      // No code_output follows
      { type: "text", text: "Done." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "run", testOptions);
    const sse = await collectSseEvents(stream);

    const toolOutput = sse.find((e) => e.type === "tool-output-available");
    expect(toolOutput).toMatchObject({
      toolCallId: "tool-0",
      output: "Execution complete",
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("emits error event when send() throws", async () => {
    const conv = errorConversation(new Error("API failure"));
    const stream = createSseStream(conv, "Hello", testOptions);
    const sse = await collectSseEvents(stream);

    expect(sse[0]).toEqual({ type: "start" });
    const errorEvent = sse.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.errorText).toContain("API failure");
  });

  // -----------------------------------------------------------------------
  // Safety net: missed text emitted from result
  // -----------------------------------------------------------------------

  it("emits missed text from result.text that was not streamed", async () => {
    const events: StreamEvent[] = [
      { type: "text", text: "Hello" },
    ];
    // result.text is longer than what was streamed
    const conv = mockConversation(events, {
      text: "Hello world!",
      files: [],
      codeArtifacts: [],
    });
    const stream = createSseStream(conv, "Hi", testOptions);
    const sse = await collectSseEvents(stream);

    const deltas = sse.filter((e) => e.type === "text-delta");
    const allText = deltas.map((e) => e.delta).join("");
    expect(allText).toContain("Hello");
    expect(allText).toContain(" world!");
  });

  // -----------------------------------------------------------------------
  // SDK debug message filtering
  // -----------------------------------------------------------------------

  it("filters out SDK 'File is now available' debug messages", async () => {
    const events: StreamEvent[] = [
      { type: "text", text: "Here is the result:" },
      { type: "text", text: "File upload.csv is now available in the current working directory" },
      { type: "text", text: " The data has 100 rows." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "analyze", testOptions);
    const sse = await collectSseEvents(stream);

    const deltas = sse.filter((e) => e.type === "text-delta");
    const allText = deltas.map((e) => e.delta).join("");
    expect(allText).toContain("Here is the result:");
    expect(allText).toContain("The data has 100 rows.");
    expect(allText).not.toContain("File upload.csv is now available");
  });

  // -----------------------------------------------------------------------
  // Tool input finalization via code_executing vs code_complete
  // -----------------------------------------------------------------------

  it("code_executing finalizes input when input is accumulated", async () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "print(42)" },
      { type: "code_executing" },
      { type: "code_output", output: "42" },
      { type: "code_complete" },
      { type: "tool_end" },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "run", testOptions);
    const sse = await collectSseEvents(stream);

    const inputAvail = sse.filter((e) => e.type === "tool-input-available");
    expect(inputAvail).toHaveLength(1);
    expect(inputAvail[0]).toMatchObject({
      toolName: "code_interpreter",
      input: { code: "print(42)" },
    });

    const toolOutput = sse.find((e) => e.type === "tool-output-available");
    expect(toolOutput).toMatchObject({ output: 42 });
  });

  // -----------------------------------------------------------------------
  // Text blocks close and reopen correctly around tools
  // -----------------------------------------------------------------------

  it("text blocks close before tool and reopen after", async () => {
    const events: StreamEvent[] = [
      { type: "text", text: "Before tool." },
      { type: "tool_start", toolName: "code_interpreter" },
      { type: "code", code: "1+1" },
      { type: "code_complete" },
      { type: "code_output", output: "2" },
      { type: "tool_end" },
      { type: "text", text: "After tool." },
    ];
    const conv = mockConversation(events);
    const stream = createSseStream(conv, "run", testOptions);
    const sse = await collectSseEvents(stream);

    const types = sse.map((e) => e.type);

    // First text block: text-start → text-delta → text-end
    const firstTextStart = types.indexOf("text-start");
    const firstTextEnd = types.indexOf("text-end");
    expect(firstTextStart).toBeLessThan(firstTextEnd);

    // Tool events between text blocks
    const toolStart = types.indexOf("tool-input-start");
    expect(firstTextEnd).toBeLessThan(toolStart);

    // Second text block after tool
    const secondTextStart = types.indexOf("text-start", firstTextStart + 1);
    const toolOutputIdx = types.indexOf("tool-output-available");
    expect(toolOutputIdx).toBeLessThan(secondTextStart);

    // IDs increment
    expect(sse[firstTextStart]).toMatchObject({ id: "text-0" });
    expect(sse[secondTextStart]).toMatchObject({ id: "text-1" });
  });
});
