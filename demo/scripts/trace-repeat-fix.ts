#!/usr/bin/env npx tsx
/**
 * Test if adding `instructions` to the Responses API fixes the "say hi" prompt.
 * Runs with and without instructions for comparison.
 */

import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "../.env.local") });

import OpenAI from "openai";

const PROMPT = `Execute TWO SEPARATE code blocks (do NOT combine them into one). Please follow these instructions:

1. say hi before doing anything else,

then:

  CODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.

then describe the output

  CODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list. also plot them with matplotlib (n vs fibonacci number).

then summarize this code block`;

const INSTRUCTIONS = "You are a helpful assistant with code execution capabilities. When the user asks you to execute multiple code blocks, you MUST execute ALL of them in separate code_interpreter calls before finishing your response. Never stop after just one code block. Always complete every requested task in a single response.";

const N = 3;

async function runTest(label: string, instructions: string | undefined) {
  const client = new OpenAI();
  let successCount = 0;

  for (let i = 1; i <= N; i++) {
    const requestParams: any = {
      model: "gpt-4o",
      input: PROMPT,
      tools: [{ type: "code_interpreter", container: { type: "auto" } }],
      include: ["code_interpreter_call.outputs"],
      stream: true,
    };
    if (instructions) {
      requestParams.instructions = instructions;
    }

    const stream: any = await client.responses.create(requestParams);
    let fullResponse: any = null;
    let toolStarts = 0;

    for await (const event of stream) {
      if (event.type === "response.output_item.added" && event.item?.type === "code_interpreter_call") {
        toolStarts++;
      }
      if (event.type === "response.completed") {
        fullResponse = event.response;
      }
    }

    const outputTypes = fullResponse?.output?.map((i: any) => i.type) ?? [];
    const toolCount = outputTypes.filter((t: string) => t === "code_interpreter_call").length;
    if (toolCount >= 2) successCount++;

    console.log(`  [${label}] Run ${i}: ${toolCount} tools, status=${fullResponse?.status}, types=[${outputTypes.join(", ")}]`);
  }

  return successCount;
}

async function main() {
  console.log("=== Testing WITHOUT instructions ===");
  const without = await runTest("no-instructions", undefined);

  console.log("\n=== Testing WITH instructions ===");
  const withInstr = await runTest("with-instructions", INSTRUCTIONS);

  console.log("\n=== Testing WITH max_output_tokens ===");
  // Also test with explicit max_output_tokens
  const client = new OpenAI();
  let maxTokensSuccess = 0;
  for (let i = 1; i <= N; i++) {
    const stream: any = await client.responses.create({
      model: "gpt-4o",
      input: PROMPT,
      instructions: INSTRUCTIONS,
      tools: [{ type: "code_interpreter", container: { type: "auto" } }],
      include: ["code_interpreter_call.outputs"],
      stream: true,
      max_output_tokens: 16384,
    } as any);

    let fullResponse: any = null;
    for await (const event of stream) {
      if (event.type === "response.completed") fullResponse = event.response;
    }
    const outputTypes = fullResponse?.output?.map((i: any) => i.type) ?? [];
    const toolCount = outputTypes.filter((t: string) => t === "code_interpreter_call").length;
    if (toolCount >= 2) maxTokensSuccess++;
    console.log(`  [instructions+max_tokens] Run ${i}: ${toolCount} tools, status=${fullResponse?.status}, types=[${outputTypes.join(", ")}]`);
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`  No instructions:              ${without}/${N} had 2+ tools`);
  console.log(`  With instructions:             ${withInstr}/${N} had 2+ tools`);
  console.log(`  Instructions + max_tokens:     ${maxTokensSuccess}/${N} had 2+ tools`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
