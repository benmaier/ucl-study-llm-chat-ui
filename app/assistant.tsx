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
import { Thread } from "@/components/assistant-ui/thread";
import { LeftSidebar, type SidebarNavItem } from "@/components/left-sidebar";
import { RightSidebar } from "@/components/right-sidebar";
import { InfoCard } from "@/components/info-card";
import { ThreadList } from "@/components/thread-list";
import { PanelLeftIcon, PlusIcon } from "lucide-react";

import type { unstable_RemoteThreadListAdapter as RemoteThreadListAdapter } from "@assistant-ui/react";

/**
 * Module-level ref for the current thread's remoteId.
 * Updated by RemoteIdTracker (inside the provider tree) and read by
 * the inner transport's prepareSendMessagesRequest callback.
 */
let currentRemoteId: string | null = null;

const threadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const res = await fetch("/api/threads");
    if (!res.ok) return { threads: [] };
    return res.json();
  },
  async initialize(threadId) {
    return { remoteId: threadId, externalId: undefined };
  },
  async fetch(threadId) {
    const res = await fetch(`/api/threads/${threadId}`);
    if (!res.ok) return { remoteId: threadId, status: "regular" as const };
    return res.json();
  },
  async rename(remoteId, newTitle) {
    await fetch(`/api/threads/${remoteId}`, {
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
      const res = await fetch(`/api/threads/${remoteId}`);
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
};

/**
 * Inner runtime hook — called by useRemoteThreadListRuntime to create
 * a fresh chat runtime for each thread.
 *
 * Uses useChat + useAISDKRuntime directly (instead of useChatRuntime)
 * so we have access to chat.setMessages() for loading historical messages.
 */
const useInnerRuntime = () => {
  const { id: threadItemId, remoteId } = useThreadListItem();

  // Stable transport reference
  const transportRef = useRef<AssistantChatTransport<UIMessage> | null>(null);
  if (!transportRef.current) {
    transportRef.current = new AssistantChatTransport({
      api: "/api/chat",
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

    fetch(`/api/threads/${remoteId}/messages`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.messages?.length) {
          chatRef.current.setMessages(data.messages);
        }
      })
      .catch(console.error);
  }, [remoteId]);

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

const MainContent = () => {
  const runtime = useAssistantRuntime();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const threadIsEmpty = useThread((s) => s.messages.length === 0);

  const navActions: SidebarNavItem[] = useMemo(
    () => [
      {
        icon: <PlusIcon className="size-4" />,
        label: "New chat",
        variant: "primary" as const,
        disabled: threadIsEmpty,
        onClick: () => runtime.switchToNewThread(),
      },
    ],
    [runtime, threadIsEmpty],
  );

  return (
    <div className="flex h-dvh w-full">
      {/* Toggle button when sidebar is closed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute left-3 top-5 z-10 text-muted-foreground hover:text-sidebar-foreground"
        >
          <PanelLeftIcon className="size-[22px]" />
        </button>
      )}

      {/* Left sidebar */}
      {sidebarOpen && (
        <LeftSidebar
          title="AI Assist"
          actions={navActions}
          onClose={() => setSidebarOpen(false)}
        >
          <ThreadList />
        </LeftSidebar>
      )}

      {/* Center chat — fills remaining space */}
      <div className="flex-1 overflow-hidden">
        <Thread />
      </div>

      {/* Right sidebar — Figma: 365px, bg #212121 */}
      <RightSidebar>
        <InfoCard title="Scenario" defaultExpanded>
          <p>
            You are assisting a professor in evaluating the outcome of an
            anti-discrimination campaign across schools in the US conducted
            for one year in the 2000.
          </p>
          <p className="mt-2">
            You have access to the professor&apos;s data folder to complete
            the analysis. Unfortunately, the professor let their kid play
            with the folder, so it may contain{" "}
            <strong>unnecessary files</strong>, and some data files may be{" "}
            <strong>corrupted or unreliable</strong>.
          </p>
          <p className="mt-2">
            You <strong>may use AI tools</strong> to support your work, but
            you are responsible for verifying results, producing plots, and
            clearly explaining your reasoning. You can also use excel,
            python, web browser or any other tool, but you may not discuss
            with anyone else. There are trick questions.
          </p>
        </InfoCard>

        <InfoCard title="Data description">
          <p>
            You are assisting a professor in evaluating the outcome of an
            anti-discrimination campaign across schools in the US conducted
            for one year in the 2000.
          </p>
          <p className="mt-2">
            You have access to the professor&apos;s data folder to complete
            the analysis. Unfortunately, the professor let their kid play
            with the folder, so it may contain{" "}
            <strong>unnecessary files</strong>, and some data files may be{" "}
            <strong>corrupted or unreliable</strong>.
          </p>
          <p className="mt-2">
            You <strong>may use AI tools</strong> to support your work, but
            you are responsible for...
          </p>
        </InfoCard>

        <InfoCard title="Tasks">
          <p>
            You are assisting a professor in evaluating the outcome of an
            anti-discrimination campaign across schools in the US conducted
            for one year in the 2000.
          </p>
          <p className="mt-2">
            You have access to the professor&apos;s data folder to complete
            the analysis. Unfortunately, the professor let their kid play
            with the folder, so it may contain{" "}
            <strong>unnecessary files</strong>, and some data files may be{" "}
            <strong>corrupted or unreliable</strong>.
          </p>
          <p className="mt-2">
            You <strong>may use AI tools</strong> to support your work, but
            you are responsible for verifying results, producing plots, and
            clearly explaining your reasoning. You can also use excel,
            python, web browser or any other tool, but you may not discuss
            with anyone else. There are trick questions.
          </p>
        </InfoCard>
      </RightSidebar>
    </div>
  );
};

export const Assistant = () => {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useInnerRuntime,
    adapter: threadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RemoteIdTracker />
      <MainContent />
    </AssistantRuntimeProvider>
  );
};
