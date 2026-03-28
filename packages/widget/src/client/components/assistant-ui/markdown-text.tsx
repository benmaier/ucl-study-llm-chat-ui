"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { type FC, memo, useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { Prism as PrismHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { SyntaxHighlighterProps } from "@assistant-ui/react-markdown";

import { TooltipIconButton } from "./tooltip-icon-button";
import { ImageLightbox } from "../image-lightbox";
import { cn } from "../lib/utils";

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md"
      components={defaultComponents}
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="aui-code-header-root mt-2.5 flex items-center justify-between rounded-t-lg border border-border/50 border-b-0 bg-muted/50 px-3 py-1.5 text-xs">
      <span className="aui-code-header-language font-medium text-muted-foreground lowercase">
        {language}
      </span>
      <TooltipIconButton tooltip="Copy" onClick={onCopy}>
        {!isCopied && <CopyIcon />}
        {isCopied && <CheckIcon />}
      </TooltipIconButton>
    </div>
  );
};

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

const CodeBlockHighlighter: FC<SyntaxHighlighterProps> = ({
  language,
  code,
  components: { Pre, Code: CodeComp },
}) => {
  return (
    <Pre>
      <CodeComp>
        <PrismHighlighter
          language={language}
          style={oneDark}
          customStyle={{
            margin: 0,
            borderRadius: "0 0 0.5rem 0.5rem",
            fontSize: "0.8rem",
            background: "transparent",
          }}
        >
          {code}
        </PrismHighlighter>
      </CodeComp>
    </Pre>
  );
};

const defaultComponents = memoizeMarkdownComponents({
  SyntaxHighlighter: CodeBlockHighlighter,
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "aui-md-h1 mt-6 mb-3 scroll-m-20 font-bold text-2xl first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mt-5 mb-2.5 scroll-m-20 font-semibold text-xl first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mt-4 mb-2 scroll-m-20 font-semibold text-lg first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mt-3.5 mb-1.5 scroll-m-20 font-semibold text-base first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "aui-md-h5 mt-2 mb-1 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "aui-md-h6 mt-2 mb-1 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn(
        "aui-md-p my-3 leading-relaxed first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  a: ({ className, href, children, ...props }) => {
    const isArtifactFile =
      href?.includes("/api/threads/") && href?.includes("/artifacts/");
    if (isArtifactFile) {
      return (
        <a
          className={cn(
            "aui-md-a inline-flex items-center gap-1 font-mono text-sm text-muted-foreground decoration-dotted underline underline-offset-4 hover:text-foreground",
            className,
          )}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        >
          {children}
          <ExternalLinkIcon className="inline size-3 shrink-0" />
        </a>
      );
    }
    return (
      <a
        className={cn(
          "aui-md-a text-primary underline underline-offset-2 hover:text-primary/80",
          className,
        )}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote my-3 border-muted-foreground/30 border-l-2 pl-4 text-muted-foreground italic",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul my-3 ml-6 list-disc marker:text-muted-foreground [&>li]:mt-1.5",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol my-3 ml-6 list-decimal marker:text-muted-foreground [&>li]:mt-1.5",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn("aui-md-hr my-4 border-muted-foreground/20", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <table
      className={cn(
        "aui-md-table my-2 w-full border-separate border-spacing-0 overflow-y-auto",
        className,
      )}
      {...props}
    />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "aui-md-th bg-muted px-2 py-1 text-left font-medium first:rounded-tl-lg last:rounded-tr-lg [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-muted-foreground/20 border-b border-l px-2 py-1 text-left last:border-r [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        "aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("aui-md-li leading-relaxed", className)} {...props} />
  ),
  sup: ({ className, ...props }) => (
    <sup
      className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "aui-md-pre overflow-x-auto rounded-t-none rounded-b-lg border border-border/50 border-t-0 bg-muted/30 p-3 text-xs leading-relaxed",
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "aui-md-inline-code rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
  img: (props) => <ImageLightbox {...props} />,
});
