"use client";

import React from "react";
import Editor from "@monaco-editor/react";

interface MonacoViewerProps {
  content: string;
  language?: string;
}

export const MonacoViewer: React.FC<MonacoViewerProps> = ({
  content,
  language = "plaintext",
}) => {
  return (
    <Editor
      height="100%"
      language={language}
      theme="vs-dark"
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
