"use client";

import { type FC, type ReactNode } from "react";

interface RightSidebarProps {
  children: ReactNode;
}

export const RightSidebar: FC<RightSidebarProps> = ({ children }) => {
  return (
    <aside className="flex h-full w-[365px] shrink-0 flex-col gap-[25px] overflow-y-auto border-l border-border bg-[#1f1e26] p-[25px]">
      {children}
    </aside>
  );
};
