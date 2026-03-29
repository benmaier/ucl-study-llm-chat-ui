"use client";

import { type FC, type ReactNode, useState, useRef, useEffect, useCallback } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./ui/collapsible";

interface InfoCardProps {
  title: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  previewLines?: number;
}

export const InfoCard: FC<InfoCardProps> = ({
  title,
  children,
  defaultExpanded = false,
  previewLines = 8,
}) => {
  const [open, setOpen] = useState(defaultExpanded);
  const [isClamped, setIsClamped] = useState(false);

  // Use callback ref so measurement happens when the element mounts
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    // Wait a frame for layout to complete
    requestAnimationFrame(() => {
      setIsClamped(el.scrollHeight > el.clientHeight + 1);
    });
  }, []);

  // For defaultExpanded cards, we need to measure once by temporarily
  // rendering the clamped version. Instead, just always show "Read less"
  // for defaultExpanded cards and measure when collapsed.
  // If it was defaultExpanded, assume it's clamped (it was expanded for a reason).
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    if (defaultExpanded && !hasChecked) {
      setIsClamped(true);
      setHasChecked(true);
    }
  }, [defaultExpanded, hasChecked]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="w-full rounded-[11px] border border-border bg-card p-[23px]">
        <h3 className="mb-3 text-lg font-normal text-card-foreground">
          {title}
        </h3>

        {!open && (
          <div>
            <div
              ref={measureRef}
              className="text-xs leading-relaxed text-card-foreground"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: previewLines,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {children}
            </div>
            {isClamped && (
              <CollapsibleTrigger className="mt-3 text-[10px] font-normal text-muted-foreground hover:text-card-foreground">
                Read more &rsaquo;
              </CollapsibleTrigger>
            )}
          </div>
        )}

        <CollapsibleContent>
          <div className="text-xs leading-relaxed text-card-foreground">
            {children}
          </div>
          {isClamped && (
            <CollapsibleTrigger className="mt-3 text-[10px] font-normal text-muted-foreground hover:text-card-foreground">
              &lsaquo; Read less
            </CollapsibleTrigger>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
