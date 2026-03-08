"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { Thread } from "@/components/assistant-ui/thread";
import { LeftSidebar, type SidebarNavItem } from "@/components/left-sidebar";
import { RightSidebar } from "@/components/right-sidebar";
import { InfoCard } from "@/components/info-card";
import { ThreadList } from "@/components/thread-list";
import { PlusIcon, SearchIcon, ImageIcon } from "lucide-react";

const navActions: SidebarNavItem[] = [
  { icon: <PlusIcon className="size-4" />, label: "New chat", variant: "primary" },
  { icon: <SearchIcon className="size-4" />, label: "Search chats" },
  { icon: <ImageIcon className="size-4" />, label: "Images" },
];

export const Assistant = () => {
  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({
      api: "/api/chat",
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-dvh w-full">
        {/* Left sidebar — Figma: 250px, bg #181818 */}
        <LeftSidebar title="AI Match" actions={navActions}>
          <ThreadList />
        </LeftSidebar>

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
    </AssistantRuntimeProvider>
  );
};
