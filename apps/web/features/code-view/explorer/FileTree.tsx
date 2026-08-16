"use client";

import React from "react";
import { FileTreeItem } from "./FileTreeItem";
import type { ViewFileNode } from "../types";

interface FileTreeProps {
  data: ViewFileNode[];
  selectedId: string | null;
  onSelect: (node: ViewFileNode) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({
  data,
  selectedId,
  onSelect,
}) => {
  return (
    <div className="flex-1 overflow-y-auto py-2">
      {data.map((node) => (
        <FileTreeItem
          key={node.id}
          node={node}
          level={0}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};
