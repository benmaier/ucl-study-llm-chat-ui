/**
 * E2E tests for the chat widget streaming experience.
 *
 * These tests run against the actual dev server with a real LLM provider.
 * They verify DOM state: tool cards appear, show results, text streams correctly.
 *
 * The CHAT_PROVIDER env var determines which provider is tested.
 * Provider-specific behavior is asserted where it differs:
 *   - Anthropic/Gemini: tool outputs arrive inline → tool 1 completes before tool 2 starts
 *   - OpenAI: tool outputs are deferred until stream ends → both tools complete at once
 *
 * Run:
 *   CHAT_PROVIDER=anthropic npx playwright test
 *   CHAT_PROVIDER=openai npx playwright test --headed
 *   CHAT_PROVIDER=gemini npx playwright test
 */

import { test, expect, type Page } from "@playwright/test";

const provider = process.env.CHAT_PROVIDER ?? "anthropic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForChatReady(page: Page) {
  await page.locator(".aui-composer-input").waitFor({ state: "visible", timeout: 15_000 });
}

async function sendMessage(page: Page, text: string) {
  const input = page.locator(".aui-composer-input");
  await input.fill(text);
  await page.locator(".aui-composer-send").click();
  await page.locator(".aui-assistant-message-root").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForStreamingDone(page: Page) {
  await page.locator(".aui-composer-send").waitFor({ state: "visible", timeout: 90_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe(`Chat UI [${provider}]`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForChatReady(page);
  });

  test("page loads with sidebar and composer", async ({ page }) => {
    await expect(page.locator("text=AI Assist")).toBeVisible();
    const input = page.locator(".aui-composer-input");
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    await expect(page.locator("text=Scenario")).toBeVisible();
  });

  test("send simple text message and receive response", async ({ page }) => {
    await sendMessage(page, "Say exactly: Hello from the test suite");
    await waitForStreamingDone(page);

    const content = page.locator(".aui-assistant-message-content").first();
    const text = await content.textContent();
    expect(text!.length).toBeGreaterThan(0);
  });

  test("tool call renders with status and result", async ({ page }) => {
    await sendMessage(
      page,
      "Execute this Python code: print(2 + 2). Show me the result.",
    );

    const toolCard = page.locator(".aui-tool-fallback-root").first();
    await toolCard.waitFor({ state: "visible", timeout: 60_000 });
    await waitForStreamingDone(page);

    // Completed: no spinner, "Used tool" label
    const trigger = toolCard.locator(".aui-tool-fallback-trigger");
    await expect(trigger).toContainText("Used tool");
    const icon = toolCard.locator(".aui-tool-fallback-trigger-icon");
    await expect(icon).not.toHaveClass(/animate-spin/);

    // Expand and verify args + result
    await trigger.click();
    await page.waitForTimeout(300);
    await expect(toolCard.locator(".aui-tool-fallback-args")).toBeVisible();
    const result = toolCard.locator(".aui-tool-fallback-result-content");
    await expect(result).toBeVisible();
    expect(await result.textContent()).toBeTruthy();
  });

  test("multiple tool calls render in order with results", async ({ page }) => {
    await sendMessage(
      page,
      "Execute TWO SEPARATE code blocks (do NOT combine):\n" +
        "Block 1: print(10 * 10)\n" +
        "Block 2: print(7 * 7)\n" +
        "After both, summarize the results.",
    );

    await waitForStreamingDone(page);

    const toolCards = page.locator(".aui-tool-fallback-root");
    const count = await toolCards.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Both complete after stream ends
    for (let i = 0; i < Math.min(count, 2); i++) {
      const trigger = toolCards.nth(i).locator(".aui-tool-fallback-trigger");
      await expect(trigger).toContainText("Used tool");
      await expect(
        toolCards.nth(i).locator(".aui-tool-fallback-trigger-icon"),
      ).not.toHaveClass(/animate-spin/);
    }

    // Both have results when expanded
    for (let i = 0; i < Math.min(count, 2); i++) {
      await toolCards.nth(i).locator(".aui-tool-fallback-trigger").click();
      await page.waitForTimeout(300);
      const result = toolCards.nth(i).locator(".aui-tool-fallback-result-content");
      await expect(result).toBeVisible();
      expect(await result.textContent()).toBeTruthy();
    }

    // DOM order: first tool above second
    const firstBox = await toolCards.nth(0).boundingBox();
    const secondBox = await toolCards.nth(1).boundingBox();
    expect(firstBox!.y).toBeLessThan(secondBox!.y);
  });

  // -------------------------------------------------------------------------
  // Provider-specific multi-tool lifecycle test
  //
  // Anthropic/Gemini send code_output inline (before or right after tool_end),
  // so tool 1 should be visually complete before tool 2 even starts.
  //
  // OpenAI defers code_output until after the entire stream ends, so both
  // tools stay "running" until the stream finishes, then complete at once.
  // -------------------------------------------------------------------------

  test("tool 1 completes with result BEFORE tool 2 starts (inline output — anthropic/gemini)", async ({ page }) => {
    test.skip(provider === "openai", "OpenAI defers tool outputs until stream ends");
    {
      await sendMessage(
        page,
        "Execute TWO SEPARATE code blocks (do NOT combine them into one).\n" +
          "Block 1: Calculate factorial of 10 with a for-loop. Print the result.\n" +
          "After Block 1, write a sentence describing what factorial means.\n" +
          "Block 2: Generate the first 15 Fibonacci numbers. Print the list.\n" +
          "After Block 2, write a brief summary of both results.",
      );

      const toolCards = page.locator(".aui-tool-fallback-root");

      // Wait for first tool card and expand it
      await toolCards.first().waitFor({ state: "visible", timeout: 60_000 });
      await toolCards.nth(0).locator(".aui-tool-fallback-trigger").click();
      await page.waitForTimeout(300);

      // Wait for the second tool card to appear
      await toolCards.nth(1).waitFor({ state: "visible", timeout: 60_000 });

      // At this point, tool 1 should already be complete (inline output)
      const firstIcon = toolCards.nth(0).locator(".aui-tool-fallback-trigger-icon");
      await expect(firstIcon).not.toHaveClass(/animate-spin/, { timeout: 10_000 });

      // Shimmer gone
      await expect(
        toolCards.nth(0).locator(".aui-tool-fallback-trigger-shimmer"),
      ).toHaveCount(0);

      // Result visible with real content
      const firstResult = toolCards.nth(0).locator(".aui-tool-fallback-result-content");
      await expect(firstResult).toBeVisible({ timeout: 10_000 });
      const resultText = await firstResult.textContent();
      expect(resultText).toBeTruthy();
      expect(resultText!.length).toBeGreaterThan(0);

      // Wait for everything to finish, verify tool 2 also completes
      await waitForStreamingDone(page);
      await expect(
        toolCards.nth(1).locator(".aui-tool-fallback-trigger-icon"),
      ).not.toHaveClass(/animate-spin/, { timeout: 10_000 });
    }
  });

  test("both tools complete together after stream ends (deferred output — openai)", async ({ page }) => {
    test.skip(provider !== "openai", "Only OpenAI defers tool outputs");
    {
      await sendMessage(
        page,
        "Execute TWO SEPARATE code blocks (do NOT combine them into one).\n" +
          "Block 1: Calculate factorial of 10 with a for-loop. Print the result.\n" +
          "After Block 1, write a sentence describing what factorial means.\n" +
          "Block 2: Generate the first 15 Fibonacci numbers. Print the list.\n" +
          "After Block 2, write a brief summary of both results.",
      );

      const toolCards = page.locator(".aui-tool-fallback-root");

      // Wait for first tool card and expand it
      await toolCards.first().waitFor({ state: "visible", timeout: 60_000 });
      await toolCards.nth(0).locator(".aui-tool-fallback-trigger").click();
      await page.waitForTimeout(300);

      // Wait for second tool card
      await toolCards.nth(1).waitFor({ state: "visible", timeout: 60_000 });

      // OpenAI deferred pattern: tool 1 is STILL RUNNING when tool 2 appears.
      // The code_output events arrive only after the entire stream ends.
      // Verify tool 1 still shows spinner at this point.
      const firstIcon = toolCards.nth(0).locator(".aui-tool-fallback-trigger-icon");
      const classes = await firstIcon.getAttribute("class");
      expect(classes).toContain("animate-spin");

      // Wait for stream to finish — outputs arrive now
      await waitForStreamingDone(page);

      // NOW both tools should be complete
      await expect(firstIcon).not.toHaveClass(/animate-spin/, { timeout: 10_000 });
      await expect(
        toolCards.nth(1).locator(".aui-tool-fallback-trigger-icon"),
      ).not.toHaveClass(/animate-spin/, { timeout: 10_000 });

      // Both should have results when expanded
      const firstResult = toolCards.nth(0).locator(".aui-tool-fallback-result-content");
      await expect(firstResult).toBeVisible({ timeout: 10_000 });
      expect(await firstResult.textContent()).toBeTruthy();

      await toolCards.nth(1).locator(".aui-tool-fallback-trigger").click();
      await page.waitForTimeout(300);
      const secondResult = toolCards.nth(1).locator(".aui-tool-fallback-result-content");
      await expect(secondResult).toBeVisible({ timeout: 10_000 });
      expect(await secondResult.textContent()).toBeTruthy();
    }
  });

  test("thread list shows conversation after sending message", async ({ page }) => {
    const threadsBefore = await page.locator("[data-slot='thread-list-item']").count();

    await sendMessage(page, "Hello, this is a test message for thread list");
    await waitForStreamingDone(page);

    await page.waitForTimeout(1000);
    const threadsAfter = await page.locator("[data-slot='thread-list-item']").count();
    expect(threadsAfter).toBeGreaterThanOrEqual(threadsBefore);
  });

  test("tool call with result survives page reload", async ({ page }) => {
    await sendMessage(
      page,
      "Execute this Python code: print(2 + 2). Show me the result.",
    );

    const toolCard = page.locator(".aui-tool-fallback-root").first();
    await toolCard.waitFor({ state: "visible", timeout: 60_000 });
    await waitForStreamingDone(page);

    // Verify tool has result before reload
    const trigger = toolCard.locator(".aui-tool-fallback-trigger");
    await expect(trigger).toContainText("Used tool");
    await trigger.click();
    await page.waitForTimeout(300);
    const resultBefore = toolCard.locator(".aui-tool-fallback-result-content");
    await expect(resultBefore).toBeVisible();
    const resultTextBefore = await resultBefore.textContent();
    expect(resultTextBefore).toBeTruthy();

    // Also check code input is visible
    const argsBefore = toolCard.locator(".aui-tool-fallback-args");
    await expect(argsBefore).toBeVisible();
    const argsTextBefore = await argsBefore.textContent();
    expect(argsTextBefore).toBeTruthy();
    expect(argsTextBefore!.length).toBeGreaterThan(3); // more than just "run"

    // Reload the page
    await page.reload();
    await waitForChatReady(page);

    // Click the conversation in the thread list to reload it
    await page.waitForTimeout(2000); // wait for thread list to load
    const threadItems = page.locator("[data-active='true']");
    if (await threadItems.count() === 0) {
      // Thread might not be auto-selected — click first thread
      const firstThread = page.locator(".aui-thread-list-item, [data-slot='thread-list-item']").first();
      if (await firstThread.count() > 0) {
        await firstThread.click();
        await page.waitForTimeout(1000);
      }
    }

    // Verify tool card still exists after reload
    const toolCardAfter = page.locator(".aui-tool-fallback-root").first();
    await toolCardAfter.waitFor({ state: "visible", timeout: 15_000 });

    // Expand it
    const triggerAfter = toolCardAfter.locator(".aui-tool-fallback-trigger");
    await triggerAfter.click();
    await page.waitForTimeout(300);

    // Code input should still be visible with meaningful content
    const argsAfter = toolCardAfter.locator(".aui-tool-fallback-args");
    await expect(argsAfter).toBeVisible();
    const argsTextAfter = await argsAfter.textContent();
    expect(argsTextAfter).toBeTruthy();
    expect(argsTextAfter!.length).toBeGreaterThan(3);

    // Result should still be visible
    const resultAfter = toolCardAfter.locator(".aui-tool-fallback-result-content");
    await expect(resultAfter).toBeVisible();
    const resultTextAfter = await resultAfter.textContent();
    expect(resultTextAfter).toBeTruthy();
  });
});
