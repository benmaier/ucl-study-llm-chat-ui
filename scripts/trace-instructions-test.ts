#!/usr/bin/env npx tsx
/**
 * Test whether adding `instructions` (system prompt) to the Responses API
 * fixes the early-stopping behavior with the "say hi" prompt.
 */

import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "../.env.local") });

// Find OpenAI in the SDK's dependency tree (hardcoded path since exports map blocks resolution)
const OpenAI = require(path.resolve("node_modules/ucl-study-llm-chat-api/node_modules/openai")).default;

const SAYHI_PROMPT = `Execute TWO SEPARATE code blocks (do NOT combine them into one). Please follow these instructions:

1. say hi before doing anything else,

then:

  CODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.

then describe the output

  CODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list. also plot them with matplotlib (n vs fibonacci number).

then summarize this code block`;

const N = 3;

interface TestConfig {
  label: string;
  instructions?: string;
  maxOutputTokens?: number;
}

const TESTS: TestConfig[] = [
  { label: "no-instructions" },
  {
    label: "instructions-v1",
    instructions: "You are a helpful assistant with code execution capabilities. When the user asks you to execute multiple code blocks, you MUST execute ALL of them before finishing your response. Do not stop after just one code block — always complete every requested task.",
  },
  {
    label: "instructions-v2",
    instructions: "IMPORTANT: You MUST complete ALL code blocks and tasks requested by the user in a SINGLE response. Do NOT stop after executing one code block. Continue generating text and code until every requested task is finished.",
  },
  {
    label: "max-tokens-16k",
    maxOutputTokens: 16384,
  },
  {
    label: "instructions-v1+max-tokens",
    instructions: "You are a helpful assistant with code execution capabilities. When the user asks you to execute multiple code blocks, you MUST execute ALL of them before finishing your response. Do not stop after just one code block — always complete every requested task.",
    maxOutputTokens: 16384,
  },
];

async function runTest(cfg: TestConfig): Promise<number> {
  const client = new OpenAI();
  let successCount = 0;

  for (let i = 0; i < N; i++) {
    const params: any = {
      model: "gpt-4o",
      input: SAYHI_PROMPT,
      tools: [{ type: "code_interpreter", container: { type: "auto" } }],
      include: ["code_interpreter_call.outputs"],
      stream: true,
    };
    if (cfg.instructions) params.instructions = cfg.instructions;
    if (cfg.maxOutputTokens) params.max_output_tokens = cfg.maxOutputTokens;

    const stream: any = await client.responses.create(params);
    let fullResponse: any = null;
    for await (const event of stream) {
      if (event.type === "response.completed") fullResponse = event.response;
    }

    const types = fullResponse?.output?.map((i: any) => i.type) ?? [];
    const toolCount = types.filter((t: string) => t === "code_interpreter_call").length;
    if (toolCount >= 2) successCount++;
    console.log(`  [${cfg.label}] run ${i+1}: ${toolCount} tools, types=[${types.join(",")}]`);
  }

  console.log(`  => ${cfg.label}: ${successCount}/${N} had 2+ tools\n`);
  return successCount;
}

async function main() {
  console.log(`Testing ${TESTS.length} configurations x ${N} runs each\n`);

  const results: Array<{ label: string; success: number }> = [];

  for (const test of TESTS) {
    const success = await runTest(test);
    results.push({ label: test.label, success });
  }

  console.log("=== SUMMARY ===");
  for (const r of results) {
    console.log(`  ${r.label}: ${r.success}/${N} (${((r.success / N) * 100).toFixed(0)}%)`);
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
