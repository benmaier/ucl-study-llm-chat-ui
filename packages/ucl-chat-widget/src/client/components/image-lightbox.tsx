"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { cn } from "./lib/utils";

/**
 * Wraps markdown-rendered images. Clicking opens a fullscreen overlay.
 * Uses a Portal so the overlay doesn't nest inside <p> tags.
 */
export function ImageLightbox({
  src,
  alt,
  className,
  ...props
}: React.ComponentProps<"img">) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        className={cn(
          "my-4 cursor-pointer rounded-lg border border-border/50 transition-opacity hover:opacity-80",
          className,
        )}
        onClick={() => setOpen(true)}
        {...props}
      />

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={close}
          >
            <button
              className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
              onClick={close}
              aria-label="Close"
            >
              <XIcon className="size-6" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt ?? ""}
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
