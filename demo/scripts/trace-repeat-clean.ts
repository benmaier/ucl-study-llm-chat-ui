#!/usr/bin/env npx tsx
/**
 * Run the CLEAN prompt (no "say hi") multiple times to verify it always works,
 * and also test variations to find what actually causes the failure.
 */

import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "../.env.local") });

const PROMPTS: Record<string, string> = {
  clean: `Execute TWO SEPARATE code blocks (do NOT combine them into one).

CODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.

CODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list.

After BOTH code executions are complete, write a brief paragraph summarizing both results.`,

  sayhi: `Execute TWO SEPARATE code blocks (do NOT combine them into one). Please follow these instructions:

1. say hi before doing anything else,

then:

  CODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.

then describe the output

  CODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list. also plot them with matplotlib (n vs fibonacci number).

then summarize this code block`,

  // Same tasks as "sayhi" but without the "say hi first" instruction
  nosayhi: `Execute TWO SEPARATE code blocks (do NOT combine them into one). Please follow these instructions:

  CODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.

then describe the output

  CODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list. also plot them with matplotlib (n vs fibonacci number).

then summarize this code block`,

  // With instructions parameter (system prompt)
  sayhi_with_instructions: `INSTRUCTIONS_MODE`,
};

const N = parseInt(process.argv[3] || "5", 10);
const promptKey = process.argv[2] || "all";

async function runN(label: string, prompt: string, instructions?: string) {
  const { executeCodeWithOpenAIMultiTurn, createOpenAIClient } = await import(
    "ucl-study-llm-chat-api"
  );
  const client = createOpenAIClient();

  const results: number[] = [];
  const firstTypes: string[] = [];

  for (let i = 0; i < N; i++) {
    const result = await executeCodeWithOpenAIMultiTurn(
      client,
      prompt,
      () => {}, // silent callback
      undefined,
    );
    const types = result.openaiOutput?.map((item: any) => item.type) ?? [];
    const toolCount = types.filter((t: string) => t === "code_interpreter_call").length;
    results.push(toolCount);
    firstTypes.push(types[0] || "none");
    process.stdout.write(`  ${label} run ${i+1}: ${toolCount} tools, first=${types[0]}, types=[${types.join(",")}]\n`);
  }

  const success = results.filter(r => r >= 2).length;
  console.log(`  => ${label}: ${success}/${N} had 2+ tools (${((success/N)*100).toFixed(0)}%)\n`);
  return { label, success, total: N };
}

async function main() {
  console.log(`Running ${N} iterations per prompt variant\n`);

  const summary: Array<{label: string, success: number, total: number}> = [];

  if (promptKey === "all" || promptKey === "clean") {
    summary.push(await runN("clean", PROMPTS.clean));
  }
  if (promptKey === "all" || promptKey === "sayhi") {
    summary.push(await runN("sayhi", PROMPTS.sayhi));
  }
  if (promptKey === "all" || promptKey === "nosayhi") {
    summary.push(await runN("nosayhi", PROMPTS.nosayhi));
  }

  console.log("=== SUMMARY ===");
  for (const s of summary) {
    console.log(`  ${s.label}: ${s.success}/${s.total} (${((s.success/s.total)*100).toFixed(0)}%)`);
  }
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
