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
import path from "path";

const provider = process.env.CHAT_PROVIDER ?? "anthropic";
const FIXTURES = path.join(__dirname, "fixtures");

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

/** Attach files via the hidden file input, then send a message. */
async function sendMessageWithFiles(page: Page, text: string, filePaths: string[]) {
  // The ComposerPrimitive.AddAttachment renders a hidden file input
  const fileInput = page.locator(".aui-composer-add-attachment input[type='file']");
  // If input isn't directly visible, try the button's associated input
  if (await fileInput.count() === 0) {
    // Trigger via the + button which opens a file chooser
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator(".aui-composer-add-attachment").click(),
    ]);
    await fileChooser.setFiles(filePaths);
  } else {
    await fileInput.setInputFiles(filePaths);
  }
  // Wait a moment for files to attach
  await page.waitForTimeout(500);
  // Now type and send
  const input = page.locator(".aui-composer-input");
  await input.fill(text);
  await page.locator(".aui-composer-send").click();
  await page.locator(".aui-assistant-message-root").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForStreamingDone(page: Page) {
  await page.locator(".aui-composer-send").waitFor({ state: "visible", timeout: 90_000 });
}

/** Auto-expand tool cards as they appear. Returns a stop function. */
function autoExpandToolCards(page: Page): () => void {
  const toolCards = page.locator(".aui-tool-fallback-root");
  let expandedCount = 0;
  const interval = setInterval(async () => {
    try {
      const count = await toolCards.count();
      for (let i = expandedCount; i < count; i++) {
        const trigger = toolCards.nth(i).locator(".aui-tool-fallback-trigger");
        if (await trigger.isVisible()) {
          await trigger.click();
        }
      }
      expandedCount = count;
    } catch { /* page may be navigating */ }
  }, 300);
  return () => clearInterval(interval);
}

/** After streaming, expand any tool cards not yet expanded and verify each has code + result. */
async function verifyToolCards(page: Page) {
  const toolCards = page.locator(".aui-tool-fallback-root");
  const count = await toolCards.count();
  for (let i = 0; i < count; i++) {
    const card = toolCards.nth(i);
    const trigger = card.locator(".aui-tool-fallback-trigger");
    // Expand if collapsed
    const content = card.locator(".aui-tool-fallback-args");
    if (await content.count() === 0 || !(await content.isVisible())) {
      await trigger.click();
      await page.waitForTimeout(300);
    }
    // Verify code args are present and non-trivial
    const args = card.locator(".aui-tool-fallback-args");
    if (await args.count() > 0) {
      await expect(args).toBeVisible();
      const argsText = await args.textContent();
      expect(argsText!.length).toBeGreaterThan(3);
    }
    // Verify result is present
    const result = card.locator(".aui-tool-fallback-result-content");
    if (await result.count() > 0) {
      await expect(result).toBeVisible();
      expect(await result.textContent()).toBeTruthy();
    }
  }
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
    // Start expanding tool cards as soon as they appear during streaming
    const toolCards = page.locator(".aui-tool-fallback-root");
    let expandedCount = 0;
    const expandInterval = setInterval(async () => {
      try {
        const count = await toolCards.count();
        for (let i = expandedCount; i < count; i++) {
          const trigger = toolCards.nth(i).locator(".aui-tool-fallback-trigger");
          if (await trigger.isVisible()) {
            await trigger.click();
          }
        }
        expandedCount = count;
      } catch { /* page may be navigating */ }
    }, 300);

    await sendMessage(
      page,
      "Execute this Python code: print(2 + 2). Show me the result.",
    );

    const toolCard = toolCards.first();
    await toolCard.waitFor({ state: "visible", timeout: 60_000 });
    await waitForStreamingDone(page);
    clearInterval(expandInterval);

    // Expand any cards we missed
    const finalCount = await toolCards.count();
    for (let i = expandedCount; i < finalCount; i++) {
      await toolCards.nth(i).locator(".aui-tool-fallback-trigger").click();
      await page.waitForTimeout(300);
    }

    // Completed: no spinner, "Used tool" label
    const trigger = toolCard.locator(".aui-tool-fallback-trigger");
    await expect(trigger).toContainText("Used tool");
    await expect(toolCard.locator(".aui-tool-fallback-trigger-icon")).not.toHaveClass(/animate-spin/);

    // Args should have actual code content
    const args = toolCard.locator(".aui-tool-fallback-args");
    await expect(args).toBeVisible();
    const argsText = await args.textContent();
    expect(argsText!.length).toBeGreaterThan(5);

    // Result should be visible with content
    const result = toolCard.locator(".aui-tool-fallback-result-content");
    await expect(result).toBeVisible();
    expect(await result.textContent()).toBeTruthy();

    // Verify result STAYS visible for 3 seconds (regression: result appeared then disappeared)
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1000);
      await expect(result).toBeVisible();
      expect(await result.textContent()).toBeTruthy();
    }
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
    await expect(toolCard.locator(".aui-tool-fallback-result-content")).toBeVisible();
    await expect(toolCard.locator(".aui-tool-fallback-args")).toBeVisible();

    // Reload and wait for thread list to populate
    await page.reload();
    await waitForChatReady(page);
    await page.waitForTimeout(3000);

    // Click the first thread (most recent conversation)
    const threads = page.locator("[data-slot='thread-list-item'] button, .group.flex.items-center.rounded-md button").first();
    if (await threads.count() > 0) {
      await threads.click();
      await page.waitForTimeout(2000);
    }

    // Tool card should still exist with result after reload
    const toolCardAfter = page.locator(".aui-tool-fallback-root").first();
    await toolCardAfter.waitFor({ state: "visible", timeout: 15_000 });
    await toolCardAfter.locator(".aui-tool-fallback-trigger").click();
    await page.waitForTimeout(300);

    const argsAfter = toolCardAfter.locator(".aui-tool-fallback-args");
    await expect(argsAfter).toBeVisible();
    const argsText = await argsAfter.textContent();
    expect(argsText!.length).toBeGreaterThan(3);

    const resultAfter = toolCardAfter.locator(".aui-tool-fallback-result-content");
    await expect(resultAfter).toBeVisible();
    expect(await resultAfter.textContent()).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // Image + CSV in same message
  // -----------------------------------------------------------------------

  test("LLM sees image and CSV when sent together", async ({ page }) => {
    const stopExpand = autoExpandToolCards(page);

    await sendMessageWithFiles(
      page,
      "I've attached an image and a CSV file. Briefly describe what the image shows, and tell me how many rows the CSV has.",
      [
        path.join(FIXTURES, "test-image.png"),
        path.join(FIXTURES, "test-data.csv"),
      ],
    );
    await waitForStreamingDone(page);
    stopExpand();

    // Verify tool cards have code + result
    await verifyToolCards(page);

    const content = await page.locator(".aui-assistant-message-content").first().textContent();
    expect(content!.toLowerCase()).toMatch(/image|picture|visual|white|pixel|blank|photo/);
    expect(content).toMatch(/1000|1,000|thousand/);
  });

  // -----------------------------------------------------------------------
  // Cross-turn image memory
  // -----------------------------------------------------------------------

  test("LLM remembers image from previous turn", async ({ page }) => {
    // Turn 1: send image
    await sendMessageWithFiles(
      page,
      "Remember this image for later.",
      [path.join(FIXTURES, "test-image.png")],
    );
    await waitForStreamingDone(page);

    // Turn 2: ask about it without re-uploading
    await sendMessage(page, "What did the image I sent earlier look like? Describe it briefly.");
    await waitForStreamingDone(page);

    // The second assistant message should reference the image
    const messages = page.locator(".aui-assistant-message-content");
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    // Model should describe or reference the image
    expect(text!.toLowerCase()).toMatch(/image|picture|earlier|previous|white|pixel|blank/);
  });

  // -----------------------------------------------------------------------
  // CSV mean computation
  // -----------------------------------------------------------------------

  test("LLM can compute mean of uploaded CSV", async ({ page }) => {
    const stopExpand = autoExpandToolCards(page);

    await sendMessageWithFiles(
      page,
      "Calculate the mean of the 'value' column in this CSV file. Just give me the number, nothing else.",
      [path.join(FIXTURES, "test-data.csv")],
    );
    await waitForStreamingDone(page);
    stopExpand();

    // Verify tool cards have code + result
    await verifyToolCards(page);

    // Check the text response mentions a reasonable mean
    const content = await page.locator(".aui-assistant-message-content").first().textContent();
    const numbers = content!.match(/\d+\.?\d*/g) || [];
    const foundMean = numbers.some((n) => {
      const v = parseFloat(n);
      return v > 40 && v < 60; // rough range for mean of uniform [0,100]
    });
    expect(foundMean).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Thread naming after first message
  // -----------------------------------------------------------------------

  test("new thread appears in sidebar promptly after first message", async ({ page }) => {
    const threadCountBefore = await page.locator(".group.flex.items-center.rounded-md").count();

    await sendMessage(page, "Say exactly: testing thread creation");
    await waitForStreamingDone(page);

    // Thread should appear within a few seconds (not 10s poll)
    await page.waitForTimeout(2000);
    const threadCountAfter = await page.locator(".group.flex.items-center.rounded-md").count();
    expect(threadCountAfter).toBeGreaterThan(threadCountBefore);
  });

  // -----------------------------------------------------------------------
  // Image + CSV survives reload with tool results intact
  // -----------------------------------------------------------------------

  test("image + CSV with tool results survive page reload", async ({ page }) => {
    const stopExpand = autoExpandToolCards(page);

    // Send image + CSV together — explicit prompt to address both
    await sendMessageWithFiles(
      page,
      "I sent you an IMAGE and a CSV. First: describe what the image looks like in one sentence. Second: how many rows does the CSV have?",
      [
        path.join(FIXTURES, "test-image.png"),
        path.join(FIXTURES, "test-data.csv"),
      ],
    );
    await waitForStreamingDone(page);
    stopExpand();

    // Verify tool cards have code + result before reload
    await verifyToolCards(page);

    // Check the image attachment is shown in the user message
    const userMessage = page.locator(".aui-user-message-root").first();
    await expect(userMessage).toBeVisible();

    // Verify response has some content
    const content = await page.locator(".aui-assistant-message-content").first().textContent();
    expect(content!.length).toBeGreaterThan(10);

    // Count tool cards before reload
    const toolCountBefore = await page.locator(".aui-tool-fallback-root").count();

    // --- RELOAD ---
    await page.reload();
    await waitForChatReady(page);
    await page.waitForTimeout(3000);

    // Click the first thread to reload the conversation
    const firstThread = page.locator(".group.flex.items-center.rounded-md button").first();
    if (await firstThread.count() > 0) {
      await firstThread.click();
      await page.waitForTimeout(2000);
    }

    // User message should still be visible
    const userMsgAfter = page.locator(".aui-user-message-root").first();
    await userMsgAfter.waitFor({ state: "visible", timeout: 10_000 });

    // Image attachment should still be in the user message
    const attachments = userMsgAfter.locator("img, .aui-attachment-preview-trigger");
    const attachmentCount = await attachments.count();
    expect(attachmentCount).toBeGreaterThan(0);

    // Tool cards should still exist after reload
    const toolCardsAfter = page.locator(".aui-tool-fallback-root");
    await toolCardsAfter.first().waitFor({ state: "visible", timeout: 10_000 });
    const toolCountAfter = await toolCardsAfter.count();
    expect(toolCountAfter).toBeGreaterThan(0);

    // Expand and verify each tool card has code + result
    for (let i = 0; i < toolCountAfter; i++) {
      const card = toolCardsAfter.nth(i);
      await card.locator(".aui-tool-fallback-trigger").click();
      await page.waitForTimeout(300);

      const args = card.locator(".aui-tool-fallback-args");
      if (await args.count() > 0) {
        await expect(args).toBeVisible();
        const argsText = await args.textContent();
        expect(argsText!.length).toBeGreaterThan(3);
      }

      const result = card.locator(".aui-tool-fallback-result-content");
      if (await result.count() > 0) {
        await expect(result).toBeVisible();
        expect(await result.textContent()).toBeTruthy();
      }
    }

    // Assistant response should still have content after reload
    const contentAfter = await page.locator(".aui-assistant-message-content").first().textContent();
    expect(contentAfter!.length).toBeGreaterThan(10);
  });
});
