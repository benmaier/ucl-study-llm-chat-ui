#!/usr/bin/env npx tsx
/**
 * 4-Layer Diagnostic Tracing for OpenAI Multi-Tool Bug
 *
 * Mode 1 (--mode sdk):    Calls the SDK directly — traces raw OpenAI events + SDK events
 * Mode 2 (--mode frontend): POSTs to localhost:3000 — traces SSE stream + reads stored data
 *
 * Usage:
 *   npx tsx scripts/trace-multi-tool.ts --mode sdk
 *   npx tsx scripts/trace-multi-tool.ts --mode frontend
 */

import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import path from "path";
import { config } from "dotenv";

// Load .env.local (same as Next.js)
config({ path: path.resolve(__dirname, "../.env.local") });

const PROMPT_CLEAN = `Execute TWO SEPARATE code blocks (do NOT combine them into one).

CODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.

CODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list.

After BOTH code executions are complete, write a brief paragraph summarizing both results.`;

const PROMPT_SAYHI = `Execute TWO SEPARATE code blocks (do NOT combine them into one). Please follow these instructions:

1. say hi before doing anything else,

then:

  CODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.

then describe the output

  CODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list. also plot them with matplotlib (n vs fibonacci number).

then summarize this code block`;

// Select prompt based on --prompt flag (default: "clean")
const promptArg = process.argv.includes("--prompt")
  ? process.argv[process.argv.indexOf("--prompt") + 1]
  : "clean";
const PROMPT = promptArg === "sayhi" ? PROMPT_SAYHI : PROMPT_CLEAN;

const TRACE_DIR = path.resolve("data/traces");
const CONVERSATIONS_DIR = path.resolve("data/conversations");

// ─── Helpers ──────────────────────────────────────────────────────────

interface TraceEntry {
  ts: string;
  layer: string;
  type: string;
  data: Record<string, unknown>;
}

function parseTraceFile(filePath: string): TraceEntry[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function shortTime(ts: string): string {
  return ts.replace(/.*T/, "").replace(/Z$/, "");
}

// ─── Mode 1: SDK-only ────────────────────────────────────────────────

async function runSdkMode() {
  console.log("=== SDK-ONLY MODE ===\n");
  console.log("Prompt:", PROMPT.slice(0, 80) + "...\n");

  // Dynamic import of the SDK
  const { executeCodeWithOpenAIMultiTurn, createOpenAIClient } = await import(
    "ucl-study-llm-chat-api"
  );

  mkdirSync(TRACE_DIR, { recursive: true });
  const traceFile = path.join(TRACE_DIR, `trace-sdk-${Date.now()}.jsonl`);
  console.log(`Trace file: ${traceFile}\n`);

  const client = createOpenAIClient();

  // Collect SDK events
  const sdkEvents: Array<{ type: string; data: Record<string, unknown> }> = [];

  console.log("Sending prompt to OpenAI...\n");
  const result = await executeCodeWithOpenAIMultiTurn(
    client,
    PROMPT,
    (event: any) => {
      sdkEvents.push({ type: event.type, data: { ...event } });
      const preview: any = { type: event.type };
      if (event.toolName) preview.toolName = event.toolName;
      if (event.text) preview.text = event.text.length > 60 ? event.text.slice(0, 60) + "..." : event.text;
      if (event.code) preview.code = event.code.length > 60 ? event.code.slice(0, 60) + "..." : event.code;
      if (event.output) preview.output = event.output.length > 60 ? event.output.slice(0, 60) + "..." : event.output;
      console.log(`  [sdk] ${event.type}`, JSON.stringify(preview));
    },
    undefined, // no previousResponseId
    { traceFile },
  );

  console.log("\n--- Send complete ---\n");

  // Parse and analyze trace
  const entries = parseTraceFile(traceFile);
  printReport(entries, sdkEvents, result);
}

// ─── Mode 2: Frontend ────────────────────────────────────────────────

async function runFrontendMode() {
  console.log("=== FRONTEND MODE ===\n");
  console.log("Prompt:", PROMPT.slice(0, 80) + "...\n");

  const threadId = `test-trace-${Date.now()}`;

  const body = {
    id: threadId,
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: PROMPT }],
      },
    ],
  };

  console.log(`Thread ID: ${threadId}`);
  console.log("POSTing to http://localhost:3000/api/chat ...\n");

  const res = await fetch("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${res.statusText}`);
    process.exit(1);
  }

  // Read SSE stream
  const sseEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const lines = buffer.split("\n");
    buffer = lines.pop()!; // keep incomplete last line

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6));
          sseEvents.push({ type: parsed.type, data: parsed });
          const preview: any = { type: parsed.type };
          if (parsed.toolCallId) preview.toolCallId = parsed.toolCallId;
          if (parsed.toolName) preview.toolName = parsed.toolName;
          if (parsed.delta && typeof parsed.delta === "string")
            preview.delta = parsed.delta.length > 40 ? parsed.delta.slice(0, 40) + "..." : parsed.delta;
          if (parsed.output !== undefined) preview.output = parsed.output;
          console.log(`  [sse-rx] ${parsed.type}`, JSON.stringify(preview));
        } catch {
          // not JSON
        }
      }
    }
  }

  console.log("\n--- Stream complete ---\n");

  // Find the trace file (server creates it with threadId in the name)
  const traceFiles = existsSync(TRACE_DIR)
    ? readdirSync(TRACE_DIR)
        .filter((f) => f.includes(threadId) && f.endsWith(".jsonl"))
        .map((f) => path.join(TRACE_DIR, f))
    : [];

  const traceFile = traceFiles[0];
  let traceEntries: TraceEntry[] = [];
  if (traceFile) {
    console.log(`Trace file: ${traceFile}`);
    traceEntries = parseTraceFile(traceFile);
  } else {
    console.log("WARNING: No trace file found. Was TRACE_DIR set when starting the server?");
  }

  // Read stored conversation
  const convDir = path.join(CONVERSATIONS_DIR, threadId);
  const convFile = path.join(convDir, "conversation.json");
  let storedConv: any = null;
  if (existsSync(convFile)) {
    storedConv = JSON.parse(readFileSync(convFile, "utf-8"));
    console.log(`Stored conversation: ${convFile}`);
  } else {
    console.log(`WARNING: No stored conversation at ${convFile}`);
  }

  console.log("");
  printFrontendReport(traceEntries, sseEvents, storedConv);
}

// ─── Reports ─────────────────────────────────────────────────────────

function printReport(
  traceEntries: TraceEntry[],
  sdkEvents: Array<{ type: string; data: Record<string, unknown> }>,
  result: any,
) {
  const openaiEvents = traceEntries.filter((e) => e.layer === "openai");

  console.log("=== LAYER 1: Raw OpenAI Events ===");
  for (const e of openaiEvents) {
    const details: string[] = [];
    if (e.data.itemType) details.push(`item=${e.data.itemType}`);
    if (e.data.itemId) details.push(`id=${e.data.itemId}`);
    if (e.data.itemStatus) details.push(`status=${e.data.itemStatus}`);
    if (e.data.responseOutputCount !== undefined) details.push(`outputCount=${e.data.responseOutputCount}`);
    if (e.data.responseStatus) details.push(`status=${e.data.responseStatus}`);
    console.log(`  [${shortTime(e.ts)}] ${e.type}${details.length ? " (" + details.join(", ") + ")" : ""}`);
  }
  const outputItemAdded = openaiEvents.filter((e) => e.type === "response.output_item.added");
  const codeInterpreterItems = outputItemAdded.filter((e) => e.data.itemType === "code_interpreter_call");
  const messageItems = outputItemAdded.filter((e) => e.data.itemType === "message");
  const completedEvent = openaiEvents.find((e) => e.type === "FULL_RESPONSE_SUMMARY");
  console.log(`\n  Summary: ${openaiEvents.length} events, ${codeInterpreterItems.length} code_interpreter_calls, ${messageItems.length} messages`);
  if (completedEvent) {
    console.log(`  Status: ${completedEvent.data.status}, Output items: ${completedEvent.data.outputCount}`);
    if (completedEvent.data.incomplete_details) {
      console.log(`  INCOMPLETE: ${JSON.stringify(completedEvent.data.incomplete_details)}`);
    }
  }

  console.log("\n=== LAYER 2: SDK StreamEvents ===");
  for (const e of sdkEvents) {
    const details: string[] = [];
    if (e.data.toolName) details.push(`tool=${e.data.toolName}`);
    if (e.data.output) details.push(`output=${String(e.data.output).slice(0, 60)}`);
    console.log(`  ${e.type}${details.length ? " (" + details.join(", ") + ")" : ""}`);
  }
  const toolStarts = sdkEvents.filter((e) => e.type === "tool_start");
  const toolEnds = sdkEvents.filter((e) => e.type === "tool_end");
  const codeOutputs = sdkEvents.filter((e) => e.type === "code_output");
  const textEvents = sdkEvents.filter((e) => e.type === "text");
  console.log(`\n  Summary: ${sdkEvents.length} events, ${toolStarts.length} tool_starts, ${toolEnds.length} tool_ends, ${codeOutputs.length} code_outputs, ${textEvents.length} text events`);

  console.log("\n=== LAYER 3: SDK Result ===");
  console.log(`  Text length: ${result?.text?.length ?? 0}`);
  console.log(`  Files: ${result?.files?.length ?? 0}`);
  console.log(`  Code artifacts: ${result?.codeArtifacts?.length ?? 0}`);
  if (result?.openaiOutput) {
    console.log(`  openaiOutput items: ${result.openaiOutput.length}`);
    console.log(`  openaiOutput types: ${result.openaiOutput.map((i: any) => i.type).join(", ")}`);
  }

  console.log("\n=== DIAGNOSIS ===");
  const apiToolCount = codeInterpreterItems.length;
  const sdkToolStartCount = toolStarts.length;
  const sdkCodeOutputCount = codeOutputs.length;

  if (apiToolCount >= 2) {
    console.log(`  ✓ OpenAI returned ${apiToolCount} code_interpreter_calls`);
  } else {
    console.log(`  ✗ OpenAI returned only ${apiToolCount} code_interpreter_call(s) (status: ${completedEvent?.data.status ?? "unknown"})`);
    console.log(`  → API-level issue. Model chose to stop after first tool.`);
  }

  if (sdkToolStartCount >= 2) {
    console.log(`  ✓ SDK emitted ${sdkToolStartCount} tool_start events`);
  } else if (apiToolCount >= 2) {
    console.log(`  ✗ SDK only emitted ${sdkToolStartCount} tool_start events (API had ${apiToolCount})`);
    console.log(`  → SDK event processing bug`);
  }

  if (sdkCodeOutputCount >= 2) {
    console.log(`  ✓ SDK emitted ${sdkCodeOutputCount} code_output events`);
  } else if (sdkToolStartCount >= 2) {
    console.log(`  ✗ SDK only emitted ${sdkCodeOutputCount} code_output events`);
  }

  console.log("");
}

function printFrontendReport(
  traceEntries: TraceEntry[],
  sseEvents: Array<{ type: string; data: Record<string, unknown> }>,
  storedConv: any,
) {
  const openaiEvents = traceEntries.filter((e) => e.layer === "openai");
  const sdkEvents = traceEntries.filter((e) => e.layer === "sdk");
  const sseTraceEvents = traceEntries.filter((e) => e.layer === "sse");

  console.log("=== LAYER 1: Raw OpenAI Events (from trace) ===");
  for (const e of openaiEvents) {
    const details: string[] = [];
    if (e.data.itemType) details.push(`item=${e.data.itemType}`);
    if (e.data.itemId) details.push(`id=${e.data.itemId}`);
    if (e.data.responseOutputCount !== undefined) details.push(`outputCount=${e.data.responseOutputCount}`);
    if (e.data.responseStatus) details.push(`status=${e.data.responseStatus}`);
    console.log(`  [${shortTime(e.ts)}] ${e.type}${details.length ? " (" + details.join(", ") + ")" : ""}`);
  }
  const apiToolItems = openaiEvents.filter(
    (e) => e.type === "response.output_item.added" && e.data.itemType === "code_interpreter_call",
  );
  const fullRespSummary = openaiEvents.find((e) => e.type === "FULL_RESPONSE_SUMMARY");
  console.log(`\n  Summary: ${openaiEvents.length} events, ${apiToolItems.length} code_interpreter_calls`);
  if (fullRespSummary) {
    console.log(`  Status: ${fullRespSummary.data.status}, Output count: ${fullRespSummary.data.outputCount}`);
  }

  console.log("\n=== LAYER 2: SDK StreamEvents (from trace) ===");
  const sdkToolStarts = sdkEvents.filter((e) => e.type === "tool_start");
  const sdkToolEnds = sdkEvents.filter((e) => e.type === "tool_end");
  const sdkCodeOutputs = sdkEvents.filter((e) => e.type === "code_output");
  const sdkTexts = sdkEvents.filter((e) => e.type === "text");
  const sendResult = sdkEvents.find((e) => e.type === "SEND_RESULT");
  for (const e of sdkEvents.slice(0, 30)) {
    console.log(`  [${shortTime(e.ts)}] ${e.type}`);
  }
  if (sdkEvents.length > 30) console.log(`  ... (${sdkEvents.length - 30} more)`);
  console.log(`\n  Summary: ${sdkEvents.length} events, ${sdkToolStarts.length} tool_starts, ${sdkToolEnds.length} tool_ends, ${sdkCodeOutputs.length} code_outputs, ${sdkTexts.length} texts`);
  if (sendResult) {
    console.log(`  Result: text=${sendResult.data.textLength} chars, files=${sendResult.data.filesCount}, artifacts=${sendResult.data.codeArtifactsCount}`);
  }

  console.log("\n=== LAYER 3: SSE Events (emitted by server) ===");
  const sseToolInputStarts = sseTraceEvents.filter((e) => e.type === "tool-input-start");
  const sseToolOutputAvail = sseTraceEvents.filter((e) => e.type === "tool-output-available");
  for (const e of sseTraceEvents.slice(0, 30)) {
    const d: string[] = [];
    if ((e.data as any).toolCallId) d.push(`id=${(e.data as any).toolCallId}`);
    if ((e.data as any).toolName) d.push(`tool=${(e.data as any).toolName}`);
    console.log(`  [${shortTime(e.ts)}] ${e.type}${d.length ? " (" + d.join(", ") + ")" : ""}`);
  }
  if (sseTraceEvents.length > 30) console.log(`  ... (${sseTraceEvents.length - 30} more)`);
  console.log(`\n  Summary: ${sseTraceEvents.length} events, ${sseToolInputStarts.length} tool-input-starts, ${sseToolOutputAvail.length} tool-output-available`);

  console.log("\n=== LAYER 3b: SSE Events (received by client) ===");
  const rxToolStarts = sseEvents.filter((e) => e.type === "tool-input-start");
  const rxToolOutputs = sseEvents.filter((e) => e.type === "tool-output-available");
  console.log(`  Received: ${sseEvents.length} events, ${rxToolStarts.length} tool-input-starts, ${rxToolOutputs.length} tool-output-available`);
  for (const e of rxToolOutputs) {
    console.log(`    tool-output-available: id=${e.data.toolCallId}, output=${JSON.stringify(e.data.output).slice(0, 80)}`);
  }

  console.log("\n=== LAYER 4: Stored Conversation ===");
  if (storedConv) {
    const turns = storedConv.turns ?? [];
    console.log(`  Turns: ${turns.length}`);
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const output = t.providerStateAfter?.openaiOutput ?? [];
      console.log(`  Turn ${t.turnNumber}:`);
      console.log(`    assistantText: ${(t.assistantText ?? "").length} chars`);
      console.log(`    codeArtifacts: ${(t.codeArtifacts ?? []).length}`);
      console.log(`    openaiOutput: ${output.length} items (${output.map((o: any) => o.type).join(", ")})`);
      for (let j = 0; j < output.length; j++) {
        const item = output[j];
        if (item.type === "code_interpreter_call") {
          const results = item.results || item.outputs || [];
          console.log(`      [${j}] code_interpreter_call: code=${(item.code ?? "").length} chars, results=${results.length}`);
        } else if (item.type === "message") {
          const textLen = item.content?.reduce((acc: number, c: any) => acc + (c.text?.length ?? 0), 0) ?? 0;
          console.log(`      [${j}] message: text=${textLen} chars`);
        }
      }
    }
  } else {
    console.log("  No stored conversation found");
  }

  console.log("\n=== DIAGNOSIS ===");
  const apiCount = apiToolItems.length;
  const sdkCount = sdkToolStarts.length;
  const sseCount = sseToolInputStarts.length;
  const rxCount = rxToolStarts.length;

  const checks = [
    { label: "OpenAI returned 2+ code_interpreter_calls", pass: apiCount >= 2, value: apiCount },
    { label: "SDK emitted 2+ tool_start events", pass: sdkCount >= 2, value: sdkCount },
    { label: "SSE emitted 2+ tool-input-start events", pass: sseCount >= 2, value: sseCount },
    { label: "Client received 2+ tool-input-start events", pass: rxCount >= 2, value: rxCount },
  ];

  for (const c of checks) {
    console.log(`  ${c.pass ? "✓" : "✗"} ${c.label} (got ${c.value})`);
    if (!c.pass) {
      console.log(`    → Bug is at or before this layer`);
      break;
    }
  }

  console.log("");
}

// ─── Main ────────────────────────────────────────────────────────────

const mode = process.argv.includes("--mode")
  ? process.argv[process.argv.indexOf("--mode") + 1]
  : "sdk";

if (mode === "sdk") {
  runSdkMode().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else if (mode === "frontend") {
  runFrontendMode().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
} else {
  console.error(`Unknown mode: ${mode}. Use --mode sdk or --mode frontend`);
  process.exit(1);
}
