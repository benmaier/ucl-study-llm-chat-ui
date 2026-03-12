/**
 * Unit tests for the chat route handler's request parsing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock conversation-store and stream-mapper so we don't hit real APIs
vi.mock("@/app/api/chat/conversation-store", () => ({
  getOrCreateConversation: vi.fn().mockResolvedValue({
    send: vi.fn().mockResolvedValue({ text: "", files: [], codeArtifacts: [] }),
  }),
  artifactsDirForThread: vi.fn().mockReturnValue("/tmp/test-artifacts"),
}));

vi.mock("@/app/api/chat/stream-mapper", () => ({
  createSseStream: vi.fn().mockReturnValue(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "start" })}\n\n`),
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`),
        );
        controller.close();
      },
    }),
  ),
}));

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts the latest user message from parts", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const { getOrCreateConversation } = await import(
      "@/app/api/chat/conversation-store"
    );
    const { createSseStream } = await import("@/app/api/chat/stream-mapper");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "t1",
        messages: [
          { role: "user", parts: [{ type: "text", text: "Hello" }] },
          { role: "assistant", parts: [{ type: "text", text: "Hi" }] },
          { role: "user", parts: [{ type: "text", text: "How?" }] },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(getOrCreateConversation).toHaveBeenCalledWith("t1");
    expect(createSseStream).toHaveBeenCalledWith(
      expect.anything(),
      "How?",
      expect.objectContaining({ threadId: "t1" }),
    );
  });

  it("uses default thread ID when id is missing", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const { getOrCreateConversation } = await import(
      "@/app/api/chat/conversation-store"
    );

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", parts: [{ type: "text", text: "test" }] },
        ],
      }),
    });

    await POST(req);
    expect(getOrCreateConversation).toHaveBeenCalledWith("default");
  });

  it("extracts text from content string fallback", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const { createSseStream } = await import("@/app/api/chat/stream-mapper");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "t2",
        messages: [{ role: "user", content: "test message" }],
      }),
    });

    await POST(req);
    expect(createSseStream).toHaveBeenCalledWith(
      expect.anything(),
      "test message",
      expect.objectContaining({ threadId: "t2" }),
    );
  });

  it("returns 400 when no user message is found", async () => {
    const { POST } = await import("@/app/api/chat/route");

    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "t3",
        messages: [{ role: "assistant", parts: [{ type: "text", text: "Hi" }] }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
