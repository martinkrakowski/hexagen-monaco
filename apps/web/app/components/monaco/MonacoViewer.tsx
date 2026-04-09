"use client";

import React, { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { useTheme } from "@/hooks/use-theme";

interface MonacoViewerProps {
  content: string;
  language?: string;
}

export const MonacoViewer: React.FC<MonacoViewerProps> = ({
  content,
  language = "plaintext",
}) => {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const monacoTheme = mounted
    ? theme === "dark"
      ? "vs-dark"
      : "vs"
    : "vs-dark";

  return (
    <Editor
      key={`${monacoTheme}-${language}`}
      height="100%"
      language={language}
      theme={monacoTheme}
      value={content}
      options={{
        readOnly: true,
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
