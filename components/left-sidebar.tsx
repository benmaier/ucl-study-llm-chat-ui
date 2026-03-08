"use client";

import { type FC, type ReactNode } from "react";
import { PanelLeftIcon } from "lucide-react";

export interface SidebarNavItem {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  variant?: "default" | "primary";
}

interface LeftSidebarProps {
  title: string;
  actions: SidebarNavItem[];
  children?: ReactNode;
}

export const LeftSidebar: FC<LeftSidebarProps> = ({
  title,
  actions,
  children,
}) => {
  return (
    <aside className="flex h-full w-[250px] shrink-0 flex-col bg-sidebar">
      {/* Header — Figma: 18px Inter Regular */}
      <div className="flex items-center justify-between px-[30px] py-5">
        <h1 className="text-lg font-normal text-sidebar-foreground">{title}</h1>
        <button className="text-muted-foreground hover:text-sidebar-foreground">
          <PanelLeftIcon className="size-[22px]" />
        </button>
      </div>

      {/* Nav actions — Figma: 14px Inter Regular, 225x35 button */}
      <div className="flex flex-col gap-1 px-3">
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            className={
              action.variant === "primary"
                ? "flex h-[35px] w-[225px] items-center gap-2 rounded-[5px] bg-secondary px-[18px] text-left text-sm font-normal text-foreground"
                : "flex items-center gap-2 px-[18px] py-2 text-left text-sm font-normal text-foreground hover:text-sidebar-foreground"
            }
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>

      {/* Children slot (e.g. thread list) */}
      <div className="mt-8 flex flex-1 flex-col overflow-hidden px-3">
        {children}
      </div>
    </aside>
  );
};
