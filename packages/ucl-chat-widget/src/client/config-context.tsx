"use client";

import { createContext, useContext, type FC, type ReactNode } from "react";
import type { ChatWidgetConfig } from "../types/config.js";

const defaults: Required<ChatWidgetConfig> = {
  sidebarTitle: "AI Assist",
  welcomeMessage: "How can I help you today?",
  threadListLabel: "Your chats",
  sidebarPanels: [],
  apiBasePath: "/api",
};

const ChatWidgetConfigContext = createContext<Required<ChatWidgetConfig>>(defaults);

export const ChatWidgetConfigProvider: FC<{
  config?: ChatWidgetConfig;
  children: ReactNode;
}> = ({ config, children }) => {
  const merged = { ...defaults, ...config };
  return (
    <ChatWidgetConfigContext.Provider value={merged}>
      {children}
    </ChatWidgetConfigContext.Provider>
  );
};

export function useChatWidgetConfig(): Required<ChatWidgetConfig> {
  return useContext(ChatWidgetConfigContext);
}
