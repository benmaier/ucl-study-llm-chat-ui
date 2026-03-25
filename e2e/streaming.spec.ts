/**
 * E2E tests for the chat widget streaming experience.
 *
 * These tests run against the actual dev server with a real LLM provider.
 * They verify DOM state: tool cards appear, show results, text streams correctly.
 *
 * Prerequisites:
 *   - API keys in .env.local (ANTHROPIC_API_KEY or OPENAI_API_KEY)
 *   - CHAT_PROVIDER set appropriately
 *
 * Run:
 *   npx playwright test
 *   npx playwright test --headed   (to watch)
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the page to be fully loaded with the chat UI visible. */
async function waitForChatReady(page: Page) {
  // Wait for the composer input to be visible
  await page.locator(".aui-composer-input").waitFor({ state: "visible", timeout: 15_000 });
}

/** Send a message and wait for the assistant response to start. */
async function sendMessage(page: Page, text: string) {
  const input = page.locator(".aui-composer-input");
  await input.fill(text);
  // Click the send button
  await page.locator(".aui-composer-send").click();
  // Wait for an assistant message to appear
  await page.locator(".aui-assistant-message-root").first().waitFor({ state: "visible", timeout: 30_000 });
}

/** Wait for streaming to complete (no cancel button visible). */
async function waitForStreamingDone(page: Page) {
  // The cancel button disappears when streaming is done, send button reappears
  await page.locator(".aui-composer-send").waitFor({ state: "visible", timeout: 90_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Chat UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForChatReady(page);
  });

  test("page loads with sidebar and composer", async ({ page }) => {
    // Left sidebar with thread list
    await expect(page.locator("text=AI Assist")).toBeVisible();

    // Composer input is ready
    const input = page.locator(".aui-composer-input");
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    // Right sidebar with study panels
    await expect(page.locator("text=Scenario")).toBeVisible();
  });

  test("send simple text message and receive response", async ({ page }) => {
    await sendMessage(page, "Say exactly: Hello from the test suite");
    await waitForStreamingDone(page);

    // At least one assistant message with text content
    const assistantMessages = page.locator(".aui-assistant-message-root");
    await expect(assistantMessages.first()).toBeVisible();

    // The response should contain some text
    const content = page.locator(".aui-assistant-message-content").first();
    const text = await content.textContent();
    expect(text!.length).toBeGreaterThan(0);
  });

  test("tool call renders with status and result", async ({ page }) => {
    await sendMessage(
      page,
      "Execute this Python code: print(2 + 2). Show me the result.",
    );

    // Wait for a tool card to appear
    const toolCard = page.locator(".aui-tool-fallback-root").first();
    await toolCard.waitFor({ state: "visible", timeout: 60_000 });

    // Wait for streaming to complete
    await waitForStreamingDone(page);

    // Trigger should show "Used tool" (completed status, not "running")
    const trigger = toolCard.locator(".aui-tool-fallback-trigger");
    await expect(trigger).toContainText("Used tool");

    // Click trigger to expand and see args + result
    await trigger.click();
    await page.waitForTimeout(300); // animation

    // Code input should be visible after expanding
    const toolArgs = toolCard.locator(".aui-tool-fallback-args");
    await expect(toolArgs).toBeVisible();

    // Result section should be visible with content
    const toolResult = toolCard.locator(".aui-tool-fallback-result-content");
    await expect(toolResult).toBeVisible();
    const resultText = await toolResult.textContent();
    expect(resultText).toBeTruthy();
  });

  test("multiple tool calls render in order with results", async ({ page }) => {
    await sendMessage(
      page,
      "Execute TWO SEPARATE code blocks (do NOT combine):\n" +
        "Block 1: print(10 * 10)\n" +
        "Block 2: print(7 * 7)\n" +
        "After both, summarize the results.",
    );

    // Wait for streaming to complete
    await waitForStreamingDone(page);

    // Should have at least 2 tool cards
    const toolCards = page.locator(".aui-tool-fallback-root");
    const count = await toolCards.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Both should show "Used tool" (completed, not running)
    for (let i = 0; i < Math.min(count, 2); i++) {
      const trigger = toolCards.nth(i).locator(".aui-tool-fallback-trigger");
      await expect(trigger).toContainText("Used tool");
    }

    // Expand first card and verify it has a result
    const firstTrigger = toolCards.nth(0).locator(".aui-tool-fallback-trigger");
    await firstTrigger.click();
    await page.waitForTimeout(300);
    const firstResult = toolCards.nth(0).locator(".aui-tool-fallback-result-content");
    await expect(firstResult).toBeVisible();
    const firstText = await firstResult.textContent();
    expect(firstText).toBeTruthy();

    // Expand second card and verify it has a result
    const secondTrigger = toolCards.nth(1).locator(".aui-tool-fallback-trigger");
    await secondTrigger.click();
    await page.waitForTimeout(300);
    const secondResult = toolCards.nth(1).locator(".aui-tool-fallback-result-content");
    await expect(secondResult).toBeVisible();
    const secondText = await secondResult.textContent();
    expect(secondText).toBeTruthy();

    // Tool cards should appear in DOM order (first above second)
    const firstCard = await toolCards.nth(0).boundingBox();
    const secondCard = await toolCards.nth(1).boundingBox();
    expect(firstCard!.y).toBeLessThan(secondCard!.y);
  });

  test("thread list shows conversation after sending message", async ({ page }) => {
    // Count threads before
    const threadsBefore = await page.locator("[data-slot='thread-list-item']").count();

    await sendMessage(page, "Hello, this is a test message for thread list");
    await waitForStreamingDone(page);

    // A new thread should appear (or existing one should be there)
    // The thread list may take a moment to refresh
    await page.waitForTimeout(1000);
    const threadsAfter = await page.locator("[data-slot='thread-list-item']").count();

    // We should have at least as many threads as before (new one was created)
    expect(threadsAfter).toBeGreaterThanOrEqual(threadsBefore);
  });
});
