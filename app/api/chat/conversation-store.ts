/**
 * In-memory conversation store backed by FileWriter for disk persistence.
 *
 * Directory layout:
 *   $CONVERSATIONS_DIR/{threadId}/conversation.json
 *   $CONVERSATIONS_DIR/{threadId}/artifacts/
 *
 * Keyed by thread ID (from assistant-ui). On cache miss, attempts to
 * resume from the persisted JSON file before creating a new Conversation.
 */

import { Conversation, FileWriter } from "ucl-study-llm-chat-api";
import { mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import path from "path";

type Provider = "anthropic" | "openai" | "gemini";

interface CacheEntry {
  conversation: Conversation;
  lastAccessedAt: number;
}

export const CONVERSATIONS_DIR = path.resolve(
  process.env.CONVERSATIONS_DIR || "data/conversations",
);
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Ensure persistence directory exists
mkdirSync(CONVERSATIONS_DIR, { recursive: true });

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

/** Sanitize threadId to prevent path traversal. */
function sanitizeId(threadId: string): string {
  return threadId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Path to conversation.json for a given thread. */
export function filePathForThread(threadId: string): string {
  const safe = sanitizeId(threadId);
  return path.join(CONVERSATIONS_DIR, safe, "conversation.json");
}

/** Path to artifacts directory for a given thread. */
export function artifactsDirForThread(threadId: string): string {
  const safe = sanitizeId(threadId);
  return path.join(CONVERSATIONS_DIR, safe, "artifacts");
}

/** Ensure the conversation directory + artifacts subdir exist. */
function ensureThreadDirs(threadId: string): void {
  mkdirSync(artifactsDirForThread(threadId), { recursive: true });
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

  ensureThreadDirs(threadId);
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

/** Thread metadata for the sidebar. */
export interface ThreadMeta {
  remoteId: string;
  title: string;
  status: "regular";
}

/**
 * Scan all conversation directories and return metadata for the thread list.
 * Titles: uses metadata.title if set, otherwise "Chat 01"..."Chat 99" by creation order.
 */
export function scanConversations(): { threads: ThreadMeta[] } {
  if (!existsSync(CONVERSATIONS_DIR)) {
    return { threads: [] };
  }

  const entries: Array<{
    id: string;
    title: string | undefined;
    createdAt: string;
  }> = [];

  for (const name of readdirSync(CONVERSATIONS_DIR, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const jsonPath = path.join(CONVERSATIONS_DIR, name.name, "conversation.json");
    if (!existsSync(jsonPath)) continue;

    try {
      const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
      // Only include threads that have at least one turn (actual messages)
      const turns = Array.isArray(raw.turns) ? raw.turns : [];
      if (turns.length === 0) continue;
      entries.push({
        id: raw.id ?? name.name,
        title: raw.metadata?.title,
        createdAt: raw.createdAt ?? "",
      });
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by creation time
  entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Assign sequential titles where metadata.title is missing
  // (ascending order: Chat 01 = oldest)
  let chatNum = 0;
  const threads: ThreadMeta[] = entries.map((e) => {
    chatNum++;
    const num = String(chatNum).padStart(2, "0");
    return {
      remoteId: e.id,
      title: e.title ?? `Chat ${num}`,
      status: "regular" as const,
    };
  });

  // Reverse so newest chats appear first in the sidebar
  threads.reverse();

  return { threads };
}

/**
 * Get metadata for a single thread.
 */
export function getConversationMeta(threadId: string): ThreadMeta | null {
  const { threads } = scanConversations();
  return threads.find((t) => t.remoteId === threadId) ?? null;
}

// Exported for testing
export { cache, getProvider };
