/**
 * LLM-generated thread titles.
 *
 * Called from the chat handler on the first user turn. Uses the cheapest
 * model available on whatever provider the Conversation was created with,
 * with no writers attached — pure one-shot chat call.
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

type Provider = "anthropic" | "openai" | "gemini";

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

/**
 * Generate a short title for a thread from the first user message.
 *
 * @param provider - Which provider to use. Derive from `conversation.getProvider()`
 *   so title-gen always uses the same provider as the live chat (critical
 *   when the widget is wired to a custom backend that doesn't set
 *   `config.provider`).
 * @param apiKey - Optional API key override. If omitted, each SDK's client
 *   falls back to its environment variable (ANTHROPIC_API_KEY / OPENAI_API_KEY
 *   / GEMINI_API_KEY|GOOGLE_API_KEY). Pass the same key the Conversation
 *   was created with when using a per-request key pool.
 * @param userMessage - The first user message to summarize.
 */
export async function generateThreadTitle(
  provider: Provider,
  apiKey: string | undefined,
  userMessage: string,
): Promise<string | null> {
  const model = TITLE_MODELS[provider];
  const prompt = `${TITLE_PROMPT}${userMessage.slice(0, 2000)}`;

  console.log(`[title-gen] Starting — provider=${provider} model=${model}`);

  try {
    let raw: string;
    if (provider === "anthropic") {
      const client = createAnthropicClient(apiKey);
      raw = await chatWithClaude(client, prompt, { model, maxTokens: 32 });
    } else if (provider === "openai") {
      const client = createOpenAIClient(apiKey);
      raw = await chatWithOpenAI(client, prompt, { model, maxTokens: 32 });
    } else {
      const client = createGeminiClient(apiKey);
      raw = await chatWithGemini(client, prompt, { model });
    }
    const title = sanitizeTitle(raw);
    if (!title) {
      console.warn(`[title-gen] Empty title after sanitize — raw="${raw.slice(0, 100)}"`);
      return null;
    }
    console.log(`[title-gen] Generated "${title}"`);
    return title;
  } catch (err) {
    console.error("[title-gen] Failed:", err);
    return null;
  }
}
