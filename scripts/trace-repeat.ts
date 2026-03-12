#!/usr/bin/env npx tsx
/**
 * Run the "say hi" prompt N times through the SDK to measure how often
 * OpenAI returns 1 vs 2+ tool calls.
 *
 * Usage: npx tsx scripts/trace-repeat.ts [count]
 */

import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "../.env.local") });

const PROMPT = `Execute TWO SEPARATE code blocks (do NOT combine them into one). Please follow these instructions:

1. say hi before doing anything else,

then:

  CODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.

then describe the output

  CODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list. also plot them with matplotlib (n vs fibonacci number).

then summarize this code block`;

const N = parseInt(process.argv[2] || "10", 10);

async function main() {
  const { executeCodeWithOpenAIMultiTurn, createOpenAIClient } = await import(
    "ucl-study-llm-chat-api"
  );

  const client = createOpenAIClient();
  const results: Array<{
    run: number;
    toolCalls: number;
    outputItems: number;
    status: string;
    incomplete: any;
    textLength: number;
    outputTypes: string[];
  }> = [];

  for (let i = 1; i <= N; i++) {
    console.log(`\n--- Run ${i}/${N} ---`);
    try {
      const sdkEvents: string[] = [];
      const result = await executeCodeWithOpenAIMultiTurn(
        client,
        PROMPT,
        (event: any) => {
          if (event.type === "tool_start" || event.type === "tool_end" || event.type === "code_output") {
            sdkEvents.push(event.type);
            if (event.type === "code_output") {
              console.log(`  code_output: ${(event.output ?? "").slice(0, 60)}`);
            }
          }
        },
        undefined, // no previousResponseId
      );

      const toolStartCount = sdkEvents.filter((e) => e === "tool_start").length;
      const outputTypes = result.openaiOutput?.map((i: any) => i.type) ?? [];
      const status = result.openaiOutput?.[result.openaiOutput.length - 1]?.status ?? "unknown";

      // Get full response info from the result itself
      const info = {
        run: i,
        toolCalls: toolStartCount,
        outputItems: result.openaiOutput?.length ?? 0,
        status: "completed", // SDK returns successfully
        incomplete: null,
        textLength: result.text?.length ?? 0,
        outputTypes,
      };

      results.push(info);
      console.log(`  Result: ${toolStartCount} tool calls, ${info.outputItems} output items, types: ${outputTypes.join(", ")}`);
    } catch (err: any) {
      console.error(`  ERROR: ${err.message}`);
      results.push({
        run: i,
        toolCalls: 0,
        outputItems: 0,
        status: "error",
        incomplete: err.message,
        textLength: 0,
        outputTypes: [],
      });
    }
  }

  console.log("\n\n=== SUMMARY ===");
  console.log(`Total runs: ${N}`);
  const withOneTool = results.filter((r) => r.toolCalls === 1);
  const withTwoTools = results.filter((r) => r.toolCalls >= 2);
  const withErrors = results.filter((r) => r.status === "error");

  console.log(`  1 tool call:  ${withOneTool.length}/${N} (${((withOneTool.length / N) * 100).toFixed(0)}%)`);
  console.log(`  2+ tool calls: ${withTwoTools.length}/${N} (${((withTwoTools.length / N) * 100).toFixed(0)}%)`);
  console.log(`  Errors:        ${withErrors.length}/${N}`);

  console.log("\nPer-run details:");
  for (const r of results) {
    console.log(`  Run ${r.run}: ${r.toolCalls} tools, ${r.outputItems} items, text=${r.textLength} chars, types=[${r.outputTypes.join(", ")}]`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
