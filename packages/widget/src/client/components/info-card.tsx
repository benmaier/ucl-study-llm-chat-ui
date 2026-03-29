"use client";

import { type FC, type ReactNode, useState } from "react";
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

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* Figma: 300px wide, bg #2d2b37, border #2f2f32, radius 10-11px */}
      <div className="w-full rounded-[11px] border border-border bg-card p-[23px]">
        {/* Figma: title 18px Inter Regular */}
        <h3 className="mb-3 text-lg font-normal text-card-foreground">
          {title}
        </h3>

        {!open && (
          <div>
            {/* Figma: body 12px Inter Regular, white text */}
            <div
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
            <CollapsibleTrigger className="mt-3 text-[10px] font-normal text-muted-foreground hover:text-card-foreground">
              Read more &rsaquo;
            </CollapsibleTrigger>
          </div>
        )}

        <CollapsibleContent>
          {/* Figma: body 12px Inter Regular, white text */}
          <div className="text-xs leading-relaxed text-card-foreground">
            {children}
          </div>
          <CollapsibleTrigger className="mt-3 text-[10px] font-normal text-muted-foreground hover:text-card-foreground">
            &lsaquo; Read less
          </CollapsibleTrigger>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
