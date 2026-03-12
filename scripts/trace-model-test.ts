#!/usr/bin/env npx tsx
/**
 * Test different models with the "say hi" prompt to see which ones
 * produce 2+ tool calls.
 */

import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "../.env.local") });

const OpenAI = require(path.resolve("node_modules/ucl-study-llm-chat-api/node_modules/openai")).default;

const SAYHI_PROMPT = `Execute TWO SEPARATE code blocks (do NOT combine them into one). Please follow these instructions:

1. say hi before doing anything else,

then:

  CODE BLOCK 1: Calculate the factorial of 10 using a for-loop. Print the result.

then describe the output

  CODE BLOCK 2: Generate the first 15 Fibonacci numbers using iteration. Print the sequence as a list. also plot them with matplotlib (n vs fibonacci number).

then summarize this code block`;

const N = 3;
const MODELS = ["gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini"];

async function testModel(model: string): Promise<number> {
  const client = new OpenAI();
  let successCount = 0;

  for (let i = 0; i < N; i++) {
    try {
      const params: any = {
        model,
        input: SAYHI_PROMPT,
        tools: [{ type: "code_interpreter", container: { type: "auto" } }],
        include: ["code_interpreter_call.outputs"],
        stream: true,
      };

      const stream: any = await client.responses.create(params);
      let fullResponse: any = null;
      for await (const event of stream) {
        if (event.type === "response.completed") fullResponse = event.response;
      }

      const types = fullResponse?.output?.map((i: any) => i.type) ?? [];
      const toolCount = types.filter((t: string) => t === "code_interpreter_call").length;
      if (toolCount >= 2) successCount++;
      console.log(`  [${model}] run ${i + 1}: ${toolCount} tools, types=[${types.join(",")}]`);
    } catch (err: any) {
      console.log(`  [${model}] run ${i + 1}: ERROR - ${err.message?.slice(0, 100)}`);
    }
  }

  console.log(`  => ${model}: ${successCount}/${N} had 2+ tools\n`);
  return successCount;
}

async function main() {
  console.log(`Testing ${MODELS.length} models x ${N} runs each\n`);

  const results: Array<{ model: string; success: number }> = [];

  for (const model of MODELS) {
    const success = await testModel(model);
    results.push({ model, success });
  }

  console.log("=== SUMMARY ===");
  for (const r of results) {
    console.log(`  ${r.model}: ${r.success}/${N} (${((r.success / N) * 100).toFixed(0)}%)`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
