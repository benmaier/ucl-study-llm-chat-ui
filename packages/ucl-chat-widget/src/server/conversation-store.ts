/**
 * Class-based conversation store backed by FileWriter for disk persistence.
 *
 * Directory layout:
 *   {conversationsDir}/{threadId}/conversation.json
 *   {conversationsDir}/{threadId}/artifacts/
 *
 * Keyed by thread ID (from assistant-ui). On cache miss, attempts to
 * resume from the persisted JSON file before creating a new Conversation.
 */

import { Conversation, FileWriter } from "ucl-study-llm-chat-api";
import { mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import path from "path";

import type { ChatRouteConfig } from "../types/config.js";

type Provider = "anthropic" | "openai" | "gemini";

interface CacheEntry {
  conversation: Conversation;
  lastAccessedAt: number;
}

/** Thread metadata for the sidebar. */
export interface ThreadMeta {
  remoteId: string;
  title: string;
  status: "regular";
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Sanitize threadId to prevent path traversal. */
function sanitizeId(threadId: string): string {
  return threadId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Manages in-memory conversation cache and disk persistence.
 *
 * Use `ConversationStore.getInstance(config)` to obtain a singleton
 * per `conversationsDir`.
 */
export class ConversationStore {
  private readonly provider: Provider;
  private readonly conversationsDir: string;
  private readonly cache = new Map<string, CacheEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  /** Singleton instances keyed by resolved conversationsDir path. */
  private static instances = new Map<string, ConversationStore>();

  /**
   * Returns a singleton ConversationStore for the given config.
   * Keyed by `conversationsDir` — multiple calls with the same dir
   * return the same instance.
   */
  static getInstance(config: ChatRouteConfig): ConversationStore {
    const dir = path.resolve(config.conversationsDir);
    let instance = ConversationStore.instances.get(dir);
    if (!instance) {
      instance = new ConversationStore(config);
      ConversationStore.instances.set(dir, instance);
    }
    return instance;
  }

  constructor(config: ChatRouteConfig) {
    this.provider = config.provider;
    this.conversationsDir = path.resolve(config.conversationsDir);

    // Ensure persistence directory exists
    mkdirSync(this.conversationsDir, { recursive: true });

    // Periodic eviction of idle conversations
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.cache) {
        if (now - entry.lastAccessedAt > IDLE_TIMEOUT_MS) {
          this.cache.delete(id);
        }
      }
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  /** Path to conversation.json for a given thread. */
  filePathForThread(threadId: string): string {
    const safe = sanitizeId(threadId);
    return path.join(this.conversationsDir, safe, "conversation.json");
  }

  /** Path to artifacts directory for a given thread. */
  artifactsDirForThread(threadId: string): string {
    const safe = sanitizeId(threadId);
    return path.join(this.conversationsDir, safe, "artifacts");
  }

  /** Ensure the conversation directory + artifacts subdir exist. */
  private ensureThreadDirs(threadId: string): void {
    mkdirSync(this.artifactsDirForThread(threadId), { recursive: true });
  }

  /**
   * Returns an existing in-memory Conversation for the given thread,
   * resumes one from disk, or creates a brand-new one.
   */
  async getOrCreateConversation(threadId: string): Promise<Conversation> {
    // 1. In-memory hit
    const cached = this.cache.get(threadId);
    if (cached) {
      cached.lastAccessedAt = Date.now();
      return cached.conversation;
    }

    this.ensureThreadDirs(threadId);
    const filePath = this.filePathForThread(threadId);

    let conversation: Conversation;

    // 2. Resume from disk
    if (existsSync(filePath)) {
      try {
        conversation = await Conversation.loadFromFile(filePath, {
          provider: this.provider,
          writers: [new FileWriter(filePath)],
        });
      } catch {
        // Corrupted file — start fresh
        conversation = new Conversation({
          provider: this.provider,
          id: threadId,
          writers: [new FileWriter(filePath)],
        });
      }
    } else {
      // 3. Brand new
      conversation = new Conversation({
        provider: this.provider,
        id: threadId,
        writers: [new FileWriter(filePath)],
      });
    }

    this.cache.set(threadId, { conversation, lastAccessedAt: Date.now() });
    return conversation;
  }

  /**
   * Scan all conversation directories and return metadata for the thread list.
   * Titles: uses metadata.title if set, otherwise "Chat 01"..."Chat 99" by creation order.
   */
  scanConversations(): { threads: ThreadMeta[] } {
    if (!existsSync(this.conversationsDir)) {
      return { threads: [] };
    }

    const entries: Array<{
      id: string;
      title: string | undefined;
      createdAt: string;
    }> = [];

    for (const name of readdirSync(this.conversationsDir, {
      withFileTypes: true,
    })) {
      if (!name.isDirectory()) continue;
      const jsonPath = path.join(
        this.conversationsDir,
        name.name,
        "conversation.json",
      );
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
  getConversationMeta(threadId: string): ThreadMeta | null {
    const { threads } = this.scanConversations();
    return threads.find((t) => t.remoteId === threadId) ?? null;
  }
}
