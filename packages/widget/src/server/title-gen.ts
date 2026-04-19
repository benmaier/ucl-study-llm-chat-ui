/**
 * LLM-generated thread titles.
 *
 * Called fire-and-forget after the first user turn. Uses the cheapest
 * model available on the configured provider, with no Conversation/writer
 * instance attached — pure one-shot chat call.
 *
 * On any failure returns null; the caller leaves the title untouched
 * so the sidebar falls back to "Chat N".
 */

import {
  createAnthropicClient,
  chatWithClaude,
  createOpenAIClient,
  chatWithOpenAI,
  createGeminiClient,
  chatWithGemini,
} from "ucl-study-llm-chat-api";

import type { ChatRouteConfig } from "../types/config.js";

type Provider = NonNullable<ChatRouteConfig["provider"]>;

/** Cheapest model per provider suitable for 3-5 word title generation. */
const TITLE_MODELS: Record<Provider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-5-nano",
  gemini: "gemini-2.5-flash-lite",
};

const TITLE_PROMPT =
  "Summarize the following user message as a short 3-5 word title. " +
  "Return only the title — no quotes, no trailing punctuation, no prefix like 'Title:'.\n\n" +
  "Message:\n";

/** Clean the model's raw reply: strip quotes, trailing punctuation, whitespace. */
function sanitizeTitle(raw: string): string {
  return raw
    .trim()
    .split("\n")[0]
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
}

export async function generateThreadTitle(
  config: ChatRouteConfig,
  userMessage: string,
): Promise<string | null> {
  const provider = config.provider;
  if (!provider) return null;

  const model = TITLE_MODELS[provider];
  const prompt = `${TITLE_PROMPT}${userMessage.slice(0, 2000)}`;

  try {
    let raw: string;
    if (provider === "anthropic") {
      const client = createAnthropicClient(config.apiKey);
      raw = await chatWithClaude(client, prompt, { model, maxTokens: 32 });
    } else if (provider === "openai") {
      const client = createOpenAIClient(config.apiKey);
      raw = await chatWithOpenAI(client, prompt, { model, maxTokens: 32 });
    } else {
      const client = createGeminiClient(config.apiKey);
      raw = await chatWithGemini(client, prompt, { model });
    }
    const title = sanitizeTitle(raw);
    return title || null;
  } catch (err) {
    console.error("[title-gen] Failed:", err);
    return null;
  }
}
