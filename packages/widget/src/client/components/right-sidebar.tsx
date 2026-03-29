"use client";

import { type FC, type ReactNode } from "react";
import { PanelRightIcon } from "lucide-react";

interface RightSidebarProps {
  children: ReactNode;
  onClose?: () => void;
}

export const RightSidebar: FC<RightSidebarProps> = ({ children, onClose }) => {
  return (
    <aside className="flex h-full w-[365px] shrink-0 flex-col overflow-y-auto border-l border-border bg-[#1f1e26] p-5">
      {onClose && (
        <button
          onClick={onClose}
          className="mb-3 text-muted-foreground hover:text-sidebar-foreground"
        >
          <PanelRightIcon className="size-[22px]" />
        </button>
      )}
      <div className="flex flex-col gap-4">
        {children}
      </div>
    </aside>
  );
};
