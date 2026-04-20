"use client";

import React, { useMemo } from "react";
import Editor from "@monaco-editor/react";
import { useTheme } from "@/hooks/useTheme";

interface MonacoViewerProps {
  content: string;
  language?: string;
  readOnly?: boolean;
}

export const MonacoViewer: React.FC<MonacoViewerProps> = ({
  content,
  language = "plaintext",
  readOnly = false,
}) => {
  const { theme } = useTheme();

  const key = useMemo(
    () => `monaco-${theme}-${language}-${content.slice(0, 20)}`,
    [theme, language, content],
  );

  return (
    <Editor
      key={key}
      height="100%"
      language={language}
      theme={theme === "dark" ? "vs-dark" : "vs"}
      value={content}
      options={{
        readOnly,
        minimap: { enabled: false },
        wordWrap: "on",
        scrollBeyondLastLine: false,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        padding: { top: 16, bottom: 16 },
        renderLineHighlight: "none",
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      }}
    />
  );
};
