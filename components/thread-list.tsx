"use client";

import { type FC } from "react";
import {
  ThreadListPrimitive,
  ThreadListItemPrimitive,
} from "@assistant-ui/react";

export const ThreadList: FC = () => {
  return (
    <div className="flex flex-col">
      {/* Figma: "Your chats" 14px #afafaf */}
      <p className="mb-2 px-[18px] text-sm font-normal text-muted-foreground">
        Your chats
      </p>
      <div className="flex-1 overflow-y-auto">
        <ThreadListPrimitive.Root className="flex flex-col gap-0.5">
          <ThreadListPrimitive.Items
            components={{ ThreadListItem }}
          />
        </ThreadListPrimitive.Root>
      </div>
    </div>
  );
};

const ThreadListItem: FC = () => {
  return (
    <ThreadListItemPrimitive.Root className="group flex items-center rounded-md transition-colors hover:bg-muted data-[active]:bg-muted">
      {/* Figma: chat items 14px Inter Regular white */}
      <ThreadListItemPrimitive.Trigger className="flex-1 truncate px-[18px] py-2 text-left text-sm font-normal text-foreground">
        <ThreadListItemPrimitive.Title fallback="New Chat" />
      </ThreadListItemPrimitive.Trigger>
    </ThreadListItemPrimitive.Root>
  );
};
