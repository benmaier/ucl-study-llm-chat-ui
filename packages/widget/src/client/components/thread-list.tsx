"use client";

import { useState, useRef, useEffect, type FC } from "react";
import {
  ThreadListPrimitive,
  ThreadListItemPrimitive,
  useThreadListItemRuntime,
  useThreadListItem,
} from "@assistant-ui/react";
import { PencilIcon } from "lucide-react";
import { useChatWidgetConfig } from "../config-context.js";

export const ThreadList: FC = () => {
  const { threadListLabel } = useChatWidgetConfig();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-2 px-[18px] text-sm font-normal text-muted-foreground">
        {threadListLabel}
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
  const runtime = useThreadListItemRuntime();
  const { title, status } = useThreadListItem();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(title ?? "");
    setIsEditing(true);
  };

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      runtime.rename(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  // Hide threads that are new and have no title (not yet persisted)
  if (!title && status === "new") return null;

  if (isEditing) {
    return (
      <div className="flex items-center rounded-md bg-muted px-[18px] py-2">
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent text-sm font-normal text-foreground outline-none"
        />
      </div>
    );
  }

  const displayTitle = title || "New Chat";

  return (
    <ThreadListItemPrimitive.Root className="group flex items-center rounded-md transition-colors hover:bg-muted data-[active]:bg-muted">
      <ThreadListItemPrimitive.Trigger className="flex-1 truncate px-[18px] py-2 text-left text-sm font-normal text-foreground">
        {displayTitle}
      </ThreadListItemPrimitive.Trigger>
      <button
        onClick={handleStartEdit}
        className="mr-2 hidden text-muted-foreground hover:text-foreground group-hover:block"
      >
        <PencilIcon className="size-3.5" />
      </button>
    </ThreadListItemPrimitive.Root>
  );
};
