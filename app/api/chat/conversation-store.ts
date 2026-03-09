/**
 * In-memory conversation store backed by FileWriter for disk persistence.
 *
 * Keyed by thread ID (from assistant-ui). On cache miss, attempts to
 * resume from the persisted JSON file before creating a new Conversation.
 */

import { Conversation, FileWriter } from "ucl-study-llm-chat-api";
import { mkdirSync, existsSync } from "fs";
import path from "path";

type Provider = "anthropic" | "openai" | "gemini";

interface CacheEntry {
  conversation: Conversation;
  lastAccessedAt: number;
}

const DATA_DIR = path.resolve("data/conversations");
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Ensure persistence directory exists
mkdirSync(DATA_DIR, { recursive: true });

const cache = new Map<string, CacheEntry>();

// Periodic eviction of idle conversations
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (now - entry.lastAccessedAt > IDLE_TIMEOUT_MS) {
      cache.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

function getProvider(): Provider {
  const p = process.env.CHAT_PROVIDER?.toLowerCase();
  if (p === "openai") return "openai";
  if (p === "gemini") return "gemini";
  return "anthropic";
}

function filePathForThread(threadId: string): string {
  // Sanitize threadId to prevent path traversal
  const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

/**
 * Returns an existing in-memory Conversation for the given thread,
 * resumes one from disk, or creates a brand-new one.
 */
export async function getOrCreateConversation(
  threadId: string,
): Promise<Conversation> {
  // 1. In-memory hit
  const cached = cache.get(threadId);
  if (cached) {
    cached.lastAccessedAt = Date.now();
    return cached.conversation;
  }

  const filePath = filePathForThread(threadId);
  const provider = getProvider();

  let conversation: Conversation;

  // 2. Resume from disk
  if (existsSync(filePath)) {
    try {
      conversation = await Conversation.loadFromFile(filePath, {
        provider,
        writers: [new FileWriter(filePath)],
      });
    } catch {
      // Corrupted file — start fresh
      conversation = new Conversation({
        provider,
        id: threadId,
        writers: [new FileWriter(filePath)],
      });
    }
  } else {
    // 3. Brand new
    conversation = new Conversation({
      provider,
      id: threadId,
      writers: [new FileWriter(filePath)],
    });
  }

  cache.set(threadId, { conversation, lastAccessedAt: Date.now() });
  return conversation;
}

// Exported for testing
export { cache, DATA_DIR, filePathForThread, getProvider };
