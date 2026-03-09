/**
 * Unit tests for the conversation store.
 *
 * Uses vi.mock to mock the SDK's Conversation and FileWriter classes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "fs";
import path from "path";

// Mock the SDK before importing the store
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

  return {
    Conversation: MockConversation,
    FileWriter: MockFileWriter,
  };
});

describe("conversation-store", () => {
  const testDataDir = path.resolve("data/conversations");

  beforeEach(async () => {
    // Clear the import cache so each test gets a fresh module & cache Map
    vi.resetModules();
    // Ensure the data directory exists
    mkdirSync(testDataDir, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a new conversation and returns the same instance on second call", async () => {
    const { getOrCreateConversation } = await import(
      "@/app/api/chat/conversation-store"
    );
    const conv1 = await getOrCreateConversation("thread-1");
    const conv2 = await getOrCreateConversation("thread-1");
    expect(conv1).toBe(conv2);
  });

  it("creates different instances for different thread IDs", async () => {
    const { getOrCreateConversation } = await import(
      "@/app/api/chat/conversation-store"
    );
    const conv1 = await getOrCreateConversation("thread-a");
    const conv2 = await getOrCreateConversation("thread-b");
    expect(conv1).not.toBe(conv2);
  });

  it("resumes from file when JSON exists on disk", async () => {
    const { Conversation } = await import("ucl-study-llm-chat-api");

    // Write a fake persisted conversation
    const filePath = path.join(testDataDir, "thread-disk.json");
    writeFileSync(filePath, JSON.stringify({ id: "thread-disk", turns: [] }));

    const { getOrCreateConversation } = await import(
      "@/app/api/chat/conversation-store"
    );
    const conv = await getOrCreateConversation("thread-disk");

    expect((Conversation as any).loadFromFile).toHaveBeenCalledWith(
      filePath,
      expect.objectContaining({ provider: "anthropic" }),
    );
    expect((conv as any)._loadedFrom).toBe(filePath);

    // Clean up test file
    if (existsSync(filePath)) rmSync(filePath);
  });

  it("uses CHAT_PROVIDER env var for provider selection", async () => {
    process.env.CHAT_PROVIDER = "openai";
    try {
      const { getProvider } = await import(
        "@/app/api/chat/conversation-store"
      );
      expect(getProvider()).toBe("openai");
    } finally {
      delete process.env.CHAT_PROVIDER;
    }
  });

  it("defaults to anthropic when CHAT_PROVIDER is unset", async () => {
    delete process.env.CHAT_PROVIDER;
    const { getProvider } = await import(
      "@/app/api/chat/conversation-store"
    );
    expect(getProvider()).toBe("anthropic");
  });

  it("sanitizes thread IDs to prevent path traversal", async () => {
    const { filePathForThread } = await import(
      "@/app/api/chat/conversation-store"
    );
    const result = filePathForThread("../../etc/passwd");
    expect(result).not.toContain("..");
    expect(result).toContain("______etc_passwd.json");
  });
});
