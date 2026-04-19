/**
 * FileConversationBackend + resolveBackend() tests.
 *
 * Uses temp directories and mocks the SDK's Conversation/FileWriter classes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "fs";
import path from "path";
import os from "os";

// Mock the SDK before importing
vi.mock("ucl-study-llm-chat-api", () => {
  class MockConversation {
    _opts: any;
    constructor(opts: any) {
      this._opts = opts;
    }
    getId() {
      return this._opts.id ?? "mock-id";
    }
    send = vi.fn();
    static loadFromFile = vi
      .fn()
      .mockImplementation(async (filePath: string, opts: any) => {
        const inst = new MockConversation({ ...opts, id: "loaded-id" });
        (inst as any)._loadedFrom = filePath;
        return inst;
      });
  }

  class MockFileWriter {
    _filePath: string;
    constructor(filePath: string) {
      this._filePath = filePath;
    }
  }

  class MockConversationWriter {}

  return {
    Conversation: MockConversation,
    FileWriter: MockFileWriter,
    ConversationWriter: MockConversationWriter,
  };
});

import { FileConversationBackend, resolveBackend } from "../server/conversation-store.js";
import type { ConversationBackend } from "../types/config.js";

describe("FileConversationBackend", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "widget-test-"));
    // Clear singleton cache between tests
    (FileConversationBackend as any).instances = new Map();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function createBackend(overrides?: Record<string, unknown>) {
    return new FileConversationBackend({
      provider: "anthropic",
      conversationsDir: tmpDir,
      ...overrides,
    } as any);
  }

  // -------------------------------------------------------------------
  // getOrCreateConversation
  // -------------------------------------------------------------------

  it("creates a new conversation for unknown thread", async () => {
    const backend = createBackend();
    const conv = await backend.getOrCreateConversation("thread-1");
    expect(conv).toBeDefined();
    expect((conv as any)._opts.provider).toBe("anthropic");
    expect((conv as any)._opts.id).toBe("thread-1");
  });

  it("returns cached conversation on second call", async () => {
    const backend = createBackend();
    const conv1 = await backend.getOrCreateConversation("thread-1");
    const conv2 = await backend.getOrCreateConversation("thread-1");
    expect(conv1).toBe(conv2);
  });

  it("returns different instances for different threads", async () => {
    const backend = createBackend();
    const conv1 = await backend.getOrCreateConversation("thread-a");
    const conv2 = await backend.getOrCreateConversation("thread-b");
    expect(conv1).not.toBe(conv2);
  });

  it("resumes from disk when conversation.json exists", async () => {
    const { Conversation } = await import("ucl-study-llm-chat-api");
    const threadDir = path.join(tmpDir, "thread-disk");
    mkdirSync(threadDir, { recursive: true });
    const filePath = path.join(threadDir, "conversation.json");
    writeFileSync(filePath, JSON.stringify({ id: "thread-disk", turns: [] }));

    const backend = createBackend();
    const conv = await backend.getOrCreateConversation("thread-disk");

    expect((Conversation as any).loadFromFile).toHaveBeenCalledWith(
      filePath,
      expect.objectContaining({ provider: "anthropic" }),
    );
    expect((conv as any)._loadedFrom).toBe(filePath);
  });

  it("falls back to new conversation on corrupted file", async () => {
    const threadDir = path.join(tmpDir, "thread-bad");
    mkdirSync(threadDir, { recursive: true });
    writeFileSync(path.join(threadDir, "conversation.json"), "NOT VALID JSON {{{");

    // Make loadFromFile throw for corrupted data
    const { Conversation } = await import("ucl-study-llm-chat-api");
    (Conversation as any).loadFromFile.mockRejectedValueOnce(new Error("parse error"));

    const backend = createBackend();
    const conv = await backend.getOrCreateConversation("thread-bad");

    // Should create fresh instead of throwing
    expect(conv).toBeDefined();
    expect((conv as any)._opts.id).toBe("thread-bad");
  });

  // -------------------------------------------------------------------
  // extraWriters
  // -------------------------------------------------------------------

  it("passes extraWriters to new conversation", async () => {
    const fakeWriter = { write: vi.fn() };
    const backend = createBackend({ extraWriters: [fakeWriter] });
    const conv = await backend.getOrCreateConversation("thread-extra");

    const writers = (conv as any)._opts.writers;
    expect(writers).toHaveLength(2); // FileWriter + fakeWriter
    expect(writers[1]).toBe(fakeWriter);
  });

  // -------------------------------------------------------------------
  // listThreads
  // -------------------------------------------------------------------

  it("lists threads sorted newest-first with auto-titles", async () => {
    // Create 3 threads with different creation times
    for (const [id, createdAt] of [
      ["thread-a", "2026-01-01T00:00:00Z"],
      ["thread-b", "2026-01-02T00:00:00Z"],
      ["thread-c", "2026-01-03T00:00:00Z"],
    ] as const) {
      const dir = path.join(tmpDir, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "conversation.json"),
        JSON.stringify({ id, createdAt, turns: [{ role: "user" }] }),
      );
    }

    const backend = createBackend();
    const { threads } = await backend.listThreads();

    expect(threads).toHaveLength(3);
    // Newest first
    expect(threads[0].remoteId).toBe("thread-c");
    expect(threads[1].remoteId).toBe("thread-b");
    expect(threads[2].remoteId).toBe("thread-a");
    // Auto-titles
    expect(threads[2].title).toBe("Chat 01"); // oldest
    expect(threads[1].title).toBe("Chat 02");
    expect(threads[0].title).toBe("Chat 03"); // newest
  });

  it("skips threads with no turns", async () => {
    const dir = path.join(tmpDir, "empty-thread");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "conversation.json"),
      JSON.stringify({ id: "empty-thread", turns: [] }),
    );

    const backend = createBackend();
    const { threads } = await backend.listThreads();
    expect(threads).toHaveLength(0);
  });

  it("uses metadata.title when available", async () => {
    const dir = path.join(tmpDir, "titled");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "conversation.json"),
      JSON.stringify({
        id: "titled",
        turns: [{ role: "user" }],
        metadata: { title: "My Custom Title" },
      }),
    );

    const backend = createBackend();
    const { threads } = await backend.listThreads();
    expect(threads[0].title).toBe("My Custom Title");
  });

  // -------------------------------------------------------------------
  // getThreadMeta / updateThreadTitle / getConversationData
  // -------------------------------------------------------------------

  it("getThreadMeta returns metadata for existing thread", async () => {
    const dir = path.join(tmpDir, "meta-thread");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "conversation.json"),
      JSON.stringify({ id: "meta-thread", turns: [{ role: "user" }] }),
    );

    const backend = createBackend();
    const meta = await backend.getThreadMeta("meta-thread");
    expect(meta).not.toBeNull();
    expect(meta!.remoteId).toBe("meta-thread");
  });

  it("getThreadMeta returns null for missing thread", async () => {
    const backend = createBackend();
    const meta = await backend.getThreadMeta("nonexistent");
    expect(meta).toBeNull();
  });

  it("updateThreadTitle writes title to a separate file (survives conversation.json rewrites)", async () => {
    const dir = path.join(tmpDir, "rename-thread");
    mkdirSync(dir, { recursive: true });
    const convPath = path.join(dir, "conversation.json");
    writeFileSync(convPath, JSON.stringify({ id: "rename-thread", turns: [{ role: "user" }] }));

    const backend = createBackend();
    await backend.updateThreadTitle("rename-thread", "New Name");

    // Title lives in title.txt, not in conversation.json — so the SDK's
    // FileWriter rewriting conversation.json after every turn can't clobber it.
    const titlePath = path.join(dir, "title.txt");
    expect(require("fs").readFileSync(titlePath, "utf-8")).toBe("New Name");

    const convData = JSON.parse(require("fs").readFileSync(convPath, "utf-8"));
    expect(convData.metadata).toBeUndefined();

    // listThreads picks it up
    const { threads } = await backend.listThreads();
    expect(threads[0].title).toBe("New Name");
  });

  it("listThreads falls back to legacy metadata.title if title.txt is missing", async () => {
    const dir = path.join(tmpDir, "legacy-thread");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "conversation.json"),
      JSON.stringify({
        id: "legacy-thread",
        turns: [{ role: "user" }],
        metadata: { title: "Legacy Title" },
      }),
    );

    const backend = createBackend();
    const { threads } = await backend.listThreads();
    expect(threads[0].title).toBe("Legacy Title");
  });

  it("getConversationData returns parsed data", async () => {
    const dir = path.join(tmpDir, "data-thread");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "conversation.json"),
      JSON.stringify({ turns: [{ role: "user", content: "hi" }], uploads: [] }),
    );

    const backend = createBackend();
    const data = await backend.getConversationData("data-thread");
    expect(data).not.toBeNull();
    expect(data!.turns).toHaveLength(1);
  });

  it("getConversationData returns null for missing thread", async () => {
    const backend = createBackend();
    const data = await backend.getConversationData("nonexistent");
    expect(data).toBeNull();
  });

  // -------------------------------------------------------------------
  // Path sanitization
  // -------------------------------------------------------------------

  it("sanitizes thread IDs to prevent path traversal", () => {
    const backend = createBackend();
    const p = backend.filePathForThread("../../etc/passwd");
    expect(p).not.toContain("..");
    expect(p).toContain("______etc_passwd");
  });

  it("artifactsDirForThread returns correct path", () => {
    const backend = createBackend();
    const p = backend.artifactsDirForThread("thread-1");
    expect(p).toContain("thread-1");
    expect(p).toContain("artifacts");
  });
});

// -------------------------------------------------------------------
// resolveBackend
// -------------------------------------------------------------------

describe("resolveBackend", () => {
  it("returns custom backend when provided", () => {
    const customBackend = { listThreads: vi.fn() } as unknown as ConversationBackend;
    const result = resolveBackend({ backend: customBackend });
    expect(result).toBe(customBackend);
  });

  it("creates FileConversationBackend from provider + conversationsDir", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "resolve-test-"));
    try {
      // Clear singletons
      (FileConversationBackend as any).instances = new Map();
      const result = resolveBackend({
        provider: "openai",
        conversationsDir: tmpDir,
      });
      expect(result).toBeInstanceOf(FileConversationBackend);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws when neither backend nor provider+dir provided", () => {
    expect(() => resolveBackend({})).toThrow(/backend.*provider/i);
  });
});
