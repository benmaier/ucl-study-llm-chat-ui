# Known Issues

## OpenAI Deferred Tool Output

**Severity**: Cosmetic (tool cards show "running" longer than expected)

OpenAI's Responses API with `include: ["code_interpreter_call.outputs"]` does NOT populate results on the streaming `response.code_interpreter_call.completed` event. Outputs only arrive in the `fullResponse` after the entire stream ends.

**Impact**: For multi-tool OpenAI requests, all tool cards show "running" simultaneously and complete at once when the stream finishes. Tool 1 does not visually complete before tool 2 starts.

**Verification**: Confirmed via live debug tracing — the SDK's `completedResults` array is always empty during streaming for OpenAI.

**Comparison**:
- Anthropic: `code_output` arrives inline after each `tool_end` — tool 1 completes before tool 2 starts
- Gemini: Same as Anthropic — inline output, sequential completion
- OpenAI: Both outputs arrive post-stream — simultaneous completion

**Workaround**: None. This is an OpenAI API limitation. The stream-mapper's deferred output queue correctly handles it — both tools get real results, just later than ideal.

## Tailwind CSS 4 Cursor Pointer

**Severity**: Cosmetic (affects all button/link hover states)

Tailwind CSS 4's preflight reset removes `cursor: pointer` from buttons and interactive elements. This must be restored manually in `globals.css`:

```css
/* OUTSIDE any @layer — layer ordering lets preflight override @layer base */
button, [role="button"], a, summary, select, label[for] {
  cursor: pointer;
}
```

Placing this inside `@layer base` does NOT work due to CSS layer precedence.

## Tailwind CSS 4 Content Scanning

**Severity**: Build (no styles generated for widget components)

Tailwind CSS 4's auto-detection does not scan `node_modules` for class names. When the widget is installed as a dependency, its utility classes won't be generated unless you add an explicit `@source` directive:

```css
@source "../node_modules/ucl-chat-widget/dist";
/* or in a workspace: */
@source "../../packages/widget/src";
```

Without this, the chat UI renders unstyled (no layout, no colors, no spacing).

## Turbopack Cache Corruption

**Severity**: Rare (dev server crash)

Turbopack (Next.js dev) can occasionally corrupt its `.next` cache, causing panics like:

```
range start index 3794010112 out of range for slice of length 69446
```

**Fix**: Delete the `.next` directory and restart:

```bash
rm -rf .next
npx next dev
```

## Node.js v24 `npx next` Compatibility

**Severity**: Environment-specific

On some Node.js v24 setups, `npx next` doesn't resolve correctly. Use the direct path:

```bash
node node_modules/next/dist/bin/next dev
```

Or in workspaces where Next.js is hoisted, `npx next dev` works from the workspace directory.

## assistant-ui `runtime.thread.reset()` Does Not Work

**Severity**: Architecture (silent data loss)

`runtime.thread.reset()` does NOT work with AI SDK runtimes. Imported ThreadMessages lack UIMessage bindings, so `onImport` clears chatHelpers state. This was discovered during initial development and is a fundamental limitation.

**Workaround**: Always use `chat.setMessages()` directly for loading historical messages. This is already implemented in `useInnerRuntime()`.

## assistant-ui Thread List Has No Public Refresh API

**Severity**: Architecture (limits cross-tab sync)

`ThreadListRuntime` has no `refresh()` method. The thread list is fetched once via `adapter.list()` and cached in `_loadThreadsPromise`. To force a refresh, the widget accesses internal fields:

```ts
const core = (runtime as any)._core?.threads;
core._loadThreadsPromise = null;
core.getLoadThreadsPromise();
```

This is wrapped in try/catch and may break if assistant-ui changes its internals. If it stops working, the thread list will still load on initial page load but won't sync across tabs.

## OpenAI gpt-4o Multi-Tool Early Stopping

**Severity**: Model behavior (not a code bug)

OpenAI's `gpt-4o` consistently stops after the first tool call when the prompt has interleaved text/tool structure. This is 100% reproducible at the SDK level.

**Fix**: The SDK defaults to `gpt-5` which handles multi-tool calls correctly (100% success rate). `gpt-4.1` and `gpt-4.1-mini` are worse (don't call code_interpreter at all). `o4-mini` partially works (67%).

## Serverless File Persistence

**Severity**: Architecture (affects Vercel deployments)

The `FileConversationBackend` writes conversations and artifacts to disk. On serverless platforms (Vercel), `/tmp` is ephemeral — files disappear between requests.

**For conversations**: Use a custom `ConversationBackend` that stores in a database, or use `extraWriters` to log turns to PostgreSQL alongside the filesystem.

**For artifacts**: Generated files (plots, CSVs) are still written to disk and served via the artifacts route. On serverless, implement a custom artifacts route that serves from `base64Data` stored in your database.

The SDK's `captureGeneratedFileData()` populates `base64Data` on all generated files (fixed in SDK 1.0.3), so the data is available for database storage.
