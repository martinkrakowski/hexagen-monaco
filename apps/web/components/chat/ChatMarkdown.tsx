"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Shared markdown renderer for AI chat messages. Cloud models (GLM-5.2 et al.)
 * reply in GitHub-flavored markdown — headings, bold, lists, tables, fenced code
 * — so rendering the raw string showed `**` / `###` / backticks as literal text.
 *
 * Styled with the typography plugin (`prose`) so the full element set is covered
 * in one place, scoped tight for chat bubbles and re-themed onto the app's tokens
 * (card background for code, foreground text, info-coloured links). Lives in
 * `components/` so both feature slices can use it (features may not import each
 * other). GFM only — no `rehype-highlight`, which would need a highlight.js theme
 * the app doesn't ship.
 */
export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none break-words prose-p:my-1.5 prose-headings:mt-2 prose-headings:mb-1 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-pre:overflow-x-auto prose-pre:bg-card prose-pre:text-foreground prose-code:text-foreground prose-a:text-info ${className ?? ""}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
