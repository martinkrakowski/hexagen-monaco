"use client";

import React, { useMemo, lazy, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MessageRendererProps } from "./types";

// Lazy load SyntaxHighlighter to avoid SSR issues
const SyntaxHighlighter = lazy(() =>
  import("react-syntax-highlighter").then((m) => ({
    default: m.default,
  })),
);

// Import styles using dynamic require to avoid SSR issues
let atomOneDark: Record<string, unknown>;
let atomOneLight: Record<string, unknown>;

if (typeof window !== "undefined") {
  // Only import styles in browser environment
  import("react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark").then(
    (m) => {
      atomOneDark = m.default;
    },
  );
  import("react-syntax-highlighter/dist/esm/styles/hljs/atom-one-light").then(
    (m) => {
      atomOneLight = m.default;
    },
  );
} else {
  // SSR fallback: empty styles
  atomOneDark = {};
  atomOneLight = {};
}

/**
 * MessageRenderer: Transforms raw Markdown strings from AI into styled,
 * semantic React elements with GFM support and syntax highlighting.
 *
 * This is a pure presentational component with zero business logic.
 * It receives raw text and returns styled DOM.
 *
 * Theme respects parent Tailwind dark mode context via:
 * - prose-invert applied when parent has dark: class
 * - syntax highlighter theme switches based on isDarkMode
 */
// Define the interface for react-markdown code component props based on documentation
interface ReactMarkdownCodeProps {
  className?: string;
  children?: React.ReactNode;
  inline?: boolean;
  [key: string]: unknown;
}

export const MessageRenderer: React.FC<MessageRendererProps> = ({
  content,
  size = "base",
  className,
  theme = "auto",
  onRenderError,
}) => {
  // Determine if dark mode is active
  const isDarkMode = useMemo(() => {
    if (theme === "auto") {
      // Read from document or Tailwind context
      return typeof document !== "undefined"
        ? document.documentElement.classList.contains("dark")
        : false;
    }
    return theme === "dark";
  }, [theme]);

  // Size mapping for responsive prose
  const sizeClasses = {
    sm: "prose-sm",
    base: "prose-base",
    lg: "prose-lg",
  };

  // Root container classes
  const containerClasses = `prose ${sizeClasses[size]} ${
    isDarkMode ? "dark:prose-invert" : ""
  } ${className || ""}`;

  try {
    return (
      <div className={containerClasses}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code(props) {
              // Extract known props with defaults
              // Using as unknown[] to avoid typing issues while maintaining safety
              const propsSafe = props as unknown as ReactMarkdownCodeProps;
              const {
                className = "",
                children = "",
                inline = false,
                ...restProps
              } = propsSafe;

              const match = /language-(\w+)/.exec(className || "");
              const language = match ? match[1] : "text";

              if (inline) {
                return (
                  <code
                    className={className}
                    {...(restProps as Record<string, unknown>)}
                  >
                    {children}
                  </code>
                );
              }

              // Use lazy-loaded SyntaxHighlighter in browser context
              return (
                <Suspense
                  fallback={
                    <pre className="bg-muted p-3 rounded-md overflow-auto text-sm">
                      {String(children).replace(/\n$/, "")}
                    </pre>
                  }
                >
                  <SyntaxHighlighterWrapper
                    language={language}
                    isDarkMode={isDarkMode}
                    restProps={restProps}
                  >
                    {String(children).replace(/\n$/, "")}
                  </SyntaxHighlighterWrapper>
                </Suspense>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  } catch (error) {
    onRenderError?.(
      error instanceof Error
        ? error
        : new Error("Unknown markdown render error"),
    );
    // Graceful fallback: render as plain text in preformatted block
    return (
      <div className={containerClasses}>
        <pre className="whitespace-pre-wrap break-words">{content}</pre>
      </div>
    );
  }
};

// Wrapper component for lazy-loaded SyntaxHighlighter
function SyntaxHighlighterWrapper({
  language,
  isDarkMode,
  restProps,
  children,
}: {
  language: string;
  isDarkMode: boolean;
  restProps: Record<string, unknown>;
  children: string;
}) {
  return (
    <SyntaxHighlighter
      language={language}
      style={isDarkMode ? atomOneDark : atomOneLight}
      PreTag="div"
      // SyntaxHighlighter ref typing issue with generic props - safe to ignore here
      {...(restProps as Record<string, unknown>)}
    >
      {children}
    </SyntaxHighlighter>
  );
}

export default MessageRenderer;
