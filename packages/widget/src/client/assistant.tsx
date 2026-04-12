"use client";

import { useState, useEffect, useMemo, useRef, type FC } from "react";
import {
  AssistantRuntimeProvider,
  useAssistantRuntime,
  useThread,
  useThreadListItem,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import {
  useAISDKRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { createAssistantStream } from "assistant-stream";
import { Thread } from "./components/assistant-ui/thread.js";
import { LeftSidebar, type SidebarNavItem } from "./components/left-sidebar.js";
import { RightSidebar } from "./components/right-sidebar.js";
import { InfoCard } from "./components/info-card.js";
import { ThreadList } from "./components/thread-list.js";
import { useCallback } from "react";
import { PanelLeftIcon, PanelRightIcon, PlusIcon } from "lucide-react";
import { useChatWidgetConfig } from "./config-context.js";

import type { unstable_RemoteThreadListAdapter as RemoteThreadListAdapter } from "@assistant-ui/react";

/**
 * Module-level ref for the current thread's remoteId.
 * Updated by RemoteIdTracker (inside the provider tree) and read by
 * the inner transport's prepareSendMessagesRequest callback.
 */
let currentRemoteId: string | null = null;

function useThreadListAdapter(): RemoteThreadListAdapter {
  const { apiBasePath } = useChatWidgetConfig();

  return useMemo(
    (): RemoteThreadListAdapter => ({
      async list() {
        const res = await fetch(`${apiBasePath}/threads`);
        if (!res.ok) return { threads: [] };
        return res.json();
      },
      async initialize(threadId) {
        // Fetch current thread list to ensure correct numbering across tabs
        try {
          await fetch(`${apiBasePath}/threads`);
        } catch {
          // Best-effort — proceed even if refresh fails
        }
        return { remoteId: threadId, externalId: undefined };
      },
      async fetch(threadId) {
        const res = await fetch(`${apiBasePath}/threads/${threadId}`);
        if (!res.ok)
          return { remoteId: threadId, status: "regular" as const };
        return res.json();
      },
      async rename(remoteId, newTitle) {
        await fetch(`${apiBasePath}/threads/${remoteId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        });
      },
      async archive() {},
      async unarchive() {},
      async delete() {},
      async generateTitle(remoteId) {
        try {
          const res = await fetch(`${apiBasePath}/threads/${remoteId}`);
          if (res.ok) {
            const meta = await res.json();
            if (meta?.title) {
              return createAssistantStream((c) => {
                c.appendText(meta.title);
                c.close();
              });
            }
          }
        } catch {
          // Fall through to empty stream
        }
        return createAssistantStream((c) => {
          c.close();
        });
      },
    }),
    [apiBasePath],
  );
}

/**
 * Inner runtime hook — called by useRemoteThreadListRuntime to create
 * a fresh chat runtime for each thread.
 */
const useInnerRuntime = () => {
  const { apiBasePath } = useChatWidgetConfig();
  const { id: threadItemId, remoteId } = useThreadListItem();

  // Stable transport reference
  const transportRef = useRef<AssistantChatTransport<UIMessage> | null>(null);
  if (!transportRef.current) {
    transportRef.current = new AssistantChatTransport({
      api: `${apiBasePath}/chat`,
      prepareSendMessagesRequest: async (options) => ({
        ...options,
        body: {
          ...options.body,
          id: currentRemoteId ?? (options as Record<string, unknown>).id,
          messages: (options as Record<string, unknown>).messages,
        },
      }),
    });
  }

  const chat = useChat({
    id: threadItemId,
    transport: transportRef.current,
    onError: (error) => {
      console.error("[chat] Stream error:", error);
    },
  });

  const runtime = useAISDKRuntime(chat);
  transportRef.current.setRuntime(runtime);

  // Load historical messages for existing threads
  const loadedRef = useRef<Set<string>>(new Set());
  const chatRef = useRef(chat);
  chatRef.current = chat;

  useEffect(() => {
    if (!remoteId) return;
    if (loadedRef.current.has(remoteId)) return;

    loadedRef.current.add(remoteId);

    // If messages already exist (active conversation), skip loading
    if (chatRef.current.messages.length > 0) return;

    fetch(`${apiBasePath}/threads/${remoteId}/messages`)
      .then((res) => {
        if (!res.ok) {
          console.error(`[chat] Failed to load messages for thread ${remoteId}: HTTP ${res.status}`);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data?.messages?.length) {
          console.log(`[chat] Loaded ${data.messages.length} messages for thread ${remoteId}`);
          chatRef.current.setMessages(data.messages);
        }
      })
      .catch((err) => console.error(`[chat] Error loading messages for thread ${remoteId}:`, err))
      .finally(() => {
        requestAnimationFrame(() => {
          document.querySelector<HTMLTextAreaElement>(".aui-composer-input")?.focus();
        });
      });
  }, [remoteId, apiBasePath]);

  return runtime;
};

/**
 * Keeps the module-level currentRemoteId in sync with the active thread.
 */
const RemoteIdTracker: FC = () => {
  const runtime = useAssistantRuntime();

  useEffect(() => {
    const sync = () => {
      const state = runtime.thread.getState();
      currentRemoteId = state.metadata?.remoteId ?? null;
    };

    const unsub = runtime.thread.subscribe(sync);
    sync();

    return unsub;
  }, [runtime]);

  return null;
};

/**
 * Keeps the thread list in sync across tabs.
 * - Polls every 10 seconds
 * - Refreshes on tab activation (visibilitychange)
 *
 * Uses assistant-ui internals (_loadThreadsPromise) to force a re-fetch.
 * Wrapped in try/catch so it silently degrades if internals change.
 */
const ThreadListSyncer: FC = () => {
  const runtime = useAssistantRuntime();

  useEffect(() => {
    const refreshThreadList = () => {
      try {
        const core = (runtime as any)._core?.threads;
        if (core && "_loadThreadsPromise" in core) {
          core._loadThreadsPromise = null;
          core.getLoadThreadsPromise();
        }
      } catch {
        // Silently ignore if internals change
      }
    };

    // Poll every 10 seconds
    const interval = setInterval(refreshThreadList, 10_000);

    // Refresh on tab activation
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshThreadList();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Refresh when a message completes (isRunning transitions to false)
    let wasRunning = false;
    const unsub = runtime.thread.subscribe(() => {
      const isRunning = runtime.thread.getState().isRunning;
      if (wasRunning && !isRunning) {
        // Small delay to let the server persist the turn
        setTimeout(refreshThreadList, 500);
      }
      wasRunning = isRunning;
    });

    return () => {
      unsub();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [runtime]);

  return null;
};

/** Hook that tracks a media query and returns whether it matches. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

const MainContent = () => {
  const config = useChatWidgetConfig();
  const runtime = useAssistantRuntime();
  const threadIsEmpty = useThread((s) => s.messages.length === 0);

  // Responsive breakpoints:
  //   < 768px  → both sidebars auto-hidden
  //   768–1100 → left visible, right auto-hidden
  //   > 1100   → all visible
  const isNarrow = useMediaQuery("(max-width: 767px)");
  const isMedium = useMediaQuery("(min-width: 768px) and (max-width: 1099px)");

  // Manual toggle state — null means "use auto behavior"
  const [leftManual, setLeftManual] = useState<boolean | null>(null);
  const [rightManual, setRightManual] = useState<boolean | null>(null);

  // Reset manual overrides when breakpoint changes
  useEffect(() => { setLeftManual(null); }, [isNarrow]);
  useEffect(() => { setRightManual(null); }, [isMedium, isNarrow]);

  // Resolved visibility: manual override takes precedence over auto
  const hasPanels = config.sidebarPanels.length > 0;
  const leftOpen = leftManual ?? (!isNarrow);
  const rightOpen = hasPanels && (rightManual ?? (!isNarrow && !isMedium));

  const toggleLeft = useCallback(() => setLeftManual((prev) => !(prev ?? !isNarrow)), [isNarrow]);
  const toggleRight = useCallback(() => setRightManual((prev) => !(prev ?? (!isNarrow && !isMedium))), [isNarrow, isMedium]);

  const navActions: SidebarNavItem[] = useMemo(
    () => [
      {
        icon: <PlusIcon className="size-4" />,
        label: "New chat",
        variant: "primary" as const,
        disabled: threadIsEmpty,
        onClick: () => {
          runtime.switchToNewThread();
          // Focus the composer input after React re-renders the new thread
          requestAnimationFrame(() => {
            const input = document.querySelector<HTMLTextAreaElement>(".aui-composer-input");
            input?.focus();
          });
        },
      },
    ],
    [runtime, threadIsEmpty],
  );

  return (
    <div className="flex h-dvh w-full">
      {/* Toggle buttons when sidebars are closed */}
      {!leftOpen && (
        <button
          onClick={toggleLeft}
          className="absolute left-3 top-5 z-10 text-muted-foreground hover:text-sidebar-foreground"
        >
          <PanelLeftIcon className="size-[22px]" />
        </button>
      )}
      {!rightOpen && hasPanels && (
        <button
          onClick={toggleRight}
          className="absolute right-3 top-5 z-10 text-muted-foreground hover:text-sidebar-foreground"
        >
          <PanelRightIcon className="size-[22px]" />
        </button>
      )}

      {/* Left sidebar */}
      {leftOpen && (
        <LeftSidebar
          title={config.sidebarTitle}
          actions={navActions}
          onClose={toggleLeft}
        >
          <ThreadList />
        </LeftSidebar>
      )}

      {/* Center chat — fills remaining space */}
      <div className="flex-1 overflow-hidden">
        <Thread />
      </div>

      {/* Right sidebar */}
      {rightOpen && (
        <RightSidebar onClose={toggleRight}>
          {config.sidebarPanels.map((panel, i) => (
            <InfoCard
              key={i}
              title={panel.title}
              defaultExpanded={panel.defaultExpanded}
            >
              {panel.content}
            </InfoCard>
          ))}
        </RightSidebar>
      )}
    </div>
  );
};

export const Assistant = () => {
  const adapter = useThreadListAdapter();

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useInnerRuntime,
    adapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RemoteIdTracker />
      <ThreadListSyncer />
      <MainContent />
    </AssistantRuntimeProvider>
  );
};
