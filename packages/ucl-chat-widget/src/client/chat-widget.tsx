"use client";

import type { ChatWidgetConfig } from "../types/config.js";
import { ChatWidgetConfigProvider } from "./config-context.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { Assistant } from "./assistant.js";

export function ChatWidget({ config }: { config?: ChatWidgetConfig }) {
  return (
    <ChatWidgetConfigProvider config={config}>
      <TooltipProvider>
        <Assistant />
      </TooltipProvider>
    </ChatWidgetConfigProvider>
  );
}
