/**
 * Integration test: OpenAI multi-tool-call rendering through the frontend API.
 *
 * Requires:
 *   - Dev server running: CHAT_PROVIDER=openai node node_modules/next/dist/bin/next dev
 *   - OpenAI API key configured in .env
 *
 * Usage:
 *   npx tsx scripts/test-frontend-multi-tool.ts
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

interface SseEvent {
  type: string;
  [key: string]: unknown;
}

async function fetchSseEvents(): Promise<SseEvent[]> {
  const threadId = `test-multi-tool-${Date.now()}`;
  const body = {
    id: threadId,
    messages: [
      {
        role: "user",
        parts: [
          {
            type: "text",
            text: "Execute TWO SEPARATE code blocks (do NOT combine them into one):\n\nCODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.\n\nCODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list.\n\nAfter BOTH code executions are complete, write a brief paragraph summarizing both results.",
          },
        ],
      },
    ],
  };

  console.log(`\nPOSTing to ${BASE_URL}/api/chat with thread ${threadId}\n`);

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: SseEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop()!;
    for (const part of parts) {
      const line = part.trim();
      if (line.startsWith("data: ")) {
        try {
          events.push(JSON.parse(line.slice(6)));
        } catch {
          console.warn("  [skip] unparseable SSE line:", line.slice(0, 100));
        }
      }
    }
  }

  if (buffer.trim().startsWith("data: ")) {
    try {
      events.push(JSON.parse(buffer.trim().slice(6)));
    } catch {}
  }

  return events;
}

function printTimeline(events: SseEvent[]) {
  console.log("--- SSE Event Timeline ---\n");
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    let summary = `  [${String(i).padStart(3)}] ${e.type}`;
    if (e.toolCallId) summary += ` (${e.toolCallId})`;
    if (e.toolName) summary += ` name=${e.toolName}`;
    if (e.type === "text-delta") {
      const delta = String(e.delta ?? "");
      summary += ` "${delta.length > 60 ? delta.slice(0, 60) + "..." : delta}"`;
    }
    if (e.type === "tool-input-delta") {
      const delta = String(e.inputTextDelta ?? "");
      summary += ` "${delta.length > 60 ? delta.slice(0, 60) + "..." : delta}"`;
    }
    if (e.type === "tool-output-available") {
      const out = String(e.output ?? "");
      summary += ` output="${out.length > 80 ? out.slice(0, 80) + "..." : out}"`;
    }
    if (e.type === "error") {
      summary += ` error="${String(e.errorText ?? "").slice(0, 100)}"`;
    }
    console.log(summary);
  }
  console.log("");
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

function runChecks(events: SseEvent[]): CheckResult[] {
  const results: CheckResult[] = [];
  const types = events.map((e) => e.type);

  // Collect key events
  const toolInputStarts = events.filter((e) => e.type === "tool-input-start");
  const toolInputAvails = events.filter((e) => e.type === "tool-input-available");
  const toolOutputAvails = events.filter((e) => e.type === "tool-output-available");
  const textDeltas = events.filter((e) => e.type === "text-delta");
  const errors = events.filter((e) => e.type === "error");

  // Check: tool-input-start count >= 2
  results.push({
    name: "tool-input-start count >= 2",
    pass: toolInputStarts.length >= 2,
    detail: `found ${toolInputStarts.length}`,
  });

  // Check: tool-input-available count >= 2
  results.push({
    name: "tool-input-available count >= 2",
    pass: toolInputAvails.length >= 2,
    detail: `found ${toolInputAvails.length}`,
  });

  // Check: tool-output-available count >= 2
  results.push({
    name: "tool-output-available count >= 2",
    pass: toolOutputAvails.length >= 2,
    detail: `found ${toolOutputAvails.length}`,
  });

  // Check: real output (not "Execution complete" or empty)
  const allRealOutput = toolOutputAvails.every((e) => {
    const out = e.output;
    return out !== "Execution complete" && out !== "" && out != null;
  });
  results.push({
    name: "all tool outputs are real (not placeholder)",
    pass: allRealOutput,
    detail: toolOutputAvails
      .map((e) => `${e.toolCallId}: "${String(e.output).slice(0, 60)}"`)
      .join(", "),
  });

  // Check: text exists
  results.push({
    name: "text-delta events exist",
    pass: textDeltas.length > 0,
    detail: `found ${textDeltas.length}`,
  });

  // Check: finish at end
  const lastType = events.length > 0 ? events[events.length - 1].type : "none";
  results.push({
    name: "last event is finish",
    pass: lastType === "finish",
    detail: `last type: ${lastType}`,
  });

  // Check: no errors
  results.push({
    name: "no error events",
    pass: errors.length === 0,
    detail: errors.length > 0 ? `errors: ${errors.map((e) => e.errorText).join("; ")}` : "clean",
  });

  // Check: ID consistency — every output-available matches a prior input-start
  const inputStartIds = new Set(toolInputStarts.map((e) => e.toolCallId));
  const outputIdsMatch = toolOutputAvails.every((e) => inputStartIds.has(e.toolCallId as string));
  results.push({
    name: "output toolCallIds match input-start toolCallIds",
    pass: outputIdsMatch,
    detail: `input IDs: [${[...inputStartIds]}], output IDs: [${toolOutputAvails.map((e) => e.toolCallId)}]`,
  });

  return results;
}

async function main() {
  console.log("=== Frontend Multi-Tool Integration Test ===\n");

  let events: SseEvent[];
  try {
    events = await fetchSseEvents();
  } catch (err) {
    console.error("Failed to fetch SSE events:", err);
    console.error("\nIs the dev server running? Start with:");
    console.error("  CHAT_PROVIDER=openai node node_modules/next/dist/bin/next dev");
    process.exit(1);
  }

  printTimeline(events);

  // Warn if model returned fewer than 2 tool calls
  const toolStarts = events.filter((e) => e.type === "tool-input-start");
  if (toolStarts.length < 2) {
    console.warn(
      `\n  WARNING: Model returned only ${toolStarts.length} tool call(s). ` +
        "This may be model behavior, not a frontend bug. " +
        "Re-run or adjust prompt if needed.\n",
    );
  }

  const checks = runChecks(events);
  let allPass = true;

  console.log("--- Checks ---\n");
  for (const check of checks) {
    const icon = check.pass ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${check.name} — ${check.detail}`);
    if (!check.pass) allPass = false;
  }

  console.log("");
  if (allPass) {
    console.log("All checks passed.");
    process.exit(0);
  } else {
    console.log("Some checks FAILED.");
    process.exit(1);
  }
}

main();
