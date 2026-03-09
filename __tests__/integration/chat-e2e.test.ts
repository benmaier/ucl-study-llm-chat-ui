/**
 * Integration tests — end-to-end using real API calls.
 *
 * Skipped when no API key is available.
 */

import { describe, it, expect, afterAll } from "vitest";
import { Conversation, FileWriter } from "ucl-study-llm-chat-api";
import type { StreamEvent } from "ucl-study-llm-chat-api";
import { existsSync, rmSync, mkdirSync } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Determine provider & skip conditions
// ---------------------------------------------------------------------------

type Provider = "anthropic" | "openai" | "gemini";

function detectProvider(): Provider {
  const p = process.env.CHAT_PROVIDER?.toLowerCase();
  if (p === "openai") return "openai";
  if (p === "gemini") return "gemini";
  return "anthropic";
}

function hasApiKey(provider: Provider): boolean {
  switch (provider) {
    case "anthropic":
      return !!process.env.ANTHROPIC_API_KEY;
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "gemini":
      return !!process.env.GOOGLE_API_KEY;
  }
}

const provider = detectProvider();
const canRun = hasApiKey(provider);

const TEST_DATA_DIR = path.resolve("data/test-conversations");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectEvents(): {
  events: StreamEvent[];
  onEvent: (e: StreamEvent) => void;
} {
  const events: StreamEvent[] = [];
  return { events, onEvent: (e) => events.push(e) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!canRun)(`Integration: ${provider}`, () => {
  const cleanupFiles: string[] = [];

  afterAll(() => {
    for (const f of cleanupFiles) {
      if (existsSync(f)) rmSync(f, { recursive: true });
    }
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
  });

  it("streams a text response end-to-end", async () => {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const filePath = path.join(TEST_DATA_DIR, "e2e-text.json");
    cleanupFiles.push(filePath);

    const conv = new Conversation({
      provider,
      writers: [new FileWriter(filePath)],
    });

    const { events, onEvent } = collectEvents();
    const result = await conv.send("Say hello in exactly one word.", onEvent);

    expect(result.text).toBeTruthy();
    expect(events.length).toBeGreaterThan(0);

    // Should have at least one text event
    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.length).toBeGreaterThan(0);
  });

  it("preserves multi-turn context", async () => {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const filePath = path.join(TEST_DATA_DIR, "e2e-multiturn.json");
    cleanupFiles.push(filePath);

    const conv = new Conversation({
      provider,
      writers: [new FileWriter(filePath)],
    });

    const noop = () => {};

    // Turn 1: set a fact
    await conv.send("Remember this number: 42. Just confirm.", noop);

    // Turn 2: ask about it
    const result = await conv.send(
      "What number did I just ask you to remember?",
      noop,
    );

    expect(result.text.toLowerCase()).toContain("42");
  });

  it("persists conversation to disk via FileWriter", async () => {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const filePath = path.join(TEST_DATA_DIR, "e2e-persist.json");
    cleanupFiles.push(filePath);

    const conv = new Conversation({
      provider,
      writers: [new FileWriter(filePath)],
    });

    await conv.send("Hello", () => {});

    // FileWriter should have written the file
    expect(existsSync(filePath)).toBe(true);

    // File should contain valid conversation data
    const { readFileSync } = await import("fs");
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(data.turns).toBeDefined();
    expect(data.turns.length).toBeGreaterThanOrEqual(1);
    expect(data.turns[0].userMessage).toBe("Hello");
  });
});
