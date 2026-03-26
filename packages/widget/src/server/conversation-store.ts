/**
 * Filesystem-backed conversation backend + backend resolver.
 *
 * Directory layout:
 *   {conversationsDir}/{threadId}/conversation.json
 *   {conversationsDir}/{threadId}/artifacts/
 */

import { Conversation, FileWriter } from "ucl-study-llm-chat-api";
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import type { ChatRouteConfig, ConversationBackend, ThreadMeta } from "../types/config.js";

type Provider = "anthropic" | "openai" | "gemini";

interface CacheEntry {
  conversation: Conversation;
  lastAccessedAt: number;
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Sanitize threadId to prevent path traversal. */
function sanitizeId(threadId: string): string {
  return threadId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Default filesystem-backed conversation backend.
 *
 * Use `FileConversationBackend.getInstance(config)` to obtain a singleton
 * per `conversationsDir`.
 */
export class FileConversationBackend implements ConversationBackend {
  private readonly config: ChatRouteConfig;
  private readonly provider: Provider;
  private readonly conversationsDir: string;
  private readonly cache = new Map<string, CacheEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  /** Singleton instances keyed by resolved conversationsDir path. */
  private static instances = new Map<string, FileConversationBackend>();

  static getInstance(config: ChatRouteConfig): FileConversationBackend {
    const dir = path.resolve(config.conversationsDir!);
    let instance = FileConversationBackend.instances.get(dir);
    if (!instance) {
      instance = new FileConversationBackend(config);
      FileConversationBackend.instances.set(dir, instance);
    }
    return instance;
  }

  constructor(config: ChatRouteConfig) {
    this.config = config;
    this.provider = config.provider as Provider;
    this.conversationsDir = path.resolve(config.conversationsDir!);

    mkdirSync(this.conversationsDir, { recursive: true });

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

  private ensureThreadDirs(threadId: string): void {
    mkdirSync(this.artifactsDirForThread(threadId), { recursive: true });
  }

  async getOrCreateConversation(threadId: string): Promise<Conversation> {
    const cached = this.cache.get(threadId);
    if (cached) {
      cached.lastAccessedAt = Date.now();
      return cached.conversation;
    }

    this.ensureThreadDirs(threadId);
    const filePath = this.filePathForThread(threadId);
    const writers = [new FileWriter(filePath), ...(this.config.extraWriters ?? [])];

    let conversation: Conversation;

    if (existsSync(filePath)) {
      try {
        conversation = await Conversation.loadFromFile(filePath, {
          provider: this.provider,
          writers,
        });
      } catch {
        conversation = new Conversation({
          provider: this.provider,
          id: threadId,
          writers,
        });
      }
    } else {
      conversation = new Conversation({
        provider: this.provider,
        id: threadId,
        writers,
      });
    }

    this.cache.set(threadId, { conversation, lastAccessedAt: Date.now() });
    return conversation;
  }

  async listThreads(): Promise<{ threads: ThreadMeta[] }> {
    if (!existsSync(this.conversationsDir)) {
      return { threads: [] };
    }

    const entries: Array<{
      id: string;
      title: string | undefined;
      createdAt: string;
    }> = [];

    for (const name of readdirSync(this.conversationsDir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const jsonPath = path.join(this.conversationsDir, name.name, "conversation.json");
      if (!existsSync(jsonPath)) continue;

      try {
        const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
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

    entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

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

    threads.reverse();
    return { threads };
  }

  async getThreadMeta(threadId: string): Promise<ThreadMeta | null> {
    const { threads } = await this.listThreads();
    return threads.find((t) => t.remoteId === threadId) ?? null;
  }

  async updateThreadTitle(threadId: string, title: string): Promise<void> {
    const filePath = this.filePathForThread(threadId);
    if (!existsSync(filePath)) throw new Error("Not found");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!data.metadata) data.metadata = {};
    data.metadata.title = title;
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  async getConversationData(
    threadId: string,
  ): Promise<{ turns: unknown[]; uploads?: unknown[] } | null> {
    const filePath = this.filePathForThread(threadId);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }
}

/**
 * Resolve the conversation backend from config.
 * If `config.backend` is provided, use it directly.
 * Otherwise create a `FileConversationBackend` from provider + conversationsDir.
 */
export function resolveBackend(config: ChatRouteConfig): ConversationBackend {
  if (config.backend) return config.backend;
  if (!config.provider || !config.conversationsDir) {
    throw new Error(
      "ChatRouteConfig requires either 'backend' or both 'provider' and 'conversationsDir'",
    );
  }
  return FileConversationBackend.getInstance(config);
}

// Keep backward-compatible alias
export const ConversationStore = FileConversationBackend;
