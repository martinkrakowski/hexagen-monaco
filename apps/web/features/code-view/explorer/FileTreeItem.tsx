"use client";

import React, { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  File,
} from "lucide-react";
import type { ViewFileNode } from "../types";
import { cn } from "@/lib/utils";

interface FileTreeItemProps {
  node: ViewFileNode;
  level: number;
  selectedId: string | null;
  onSelect: (node: ViewFileNode) => void;
}

export const FileTreeItem: React.FC<FileTreeItemProps> = ({
  node,
  level,
  selectedId,
  onSelect,
}) => {
  const [isOpen, setIsOpen] = useState(level === 0);

  const isFile = node.type === "file";
  const isSelected = selectedId === node.id;

  const getFileIcon = () => {
    if (!node.language)
      return <File size={14} className="text-muted-foreground" />;
    if (["typescript", "javascript"].includes(node.language))
      return <FileCode size={14} className="text-primary" />;
    if (node.language === "json")
      return <FileJson size={14} className="text-warning" />;
    if (node.language === "markdown")
      return <FileText size={14} className="text-primary/70" />;
    return <File size={14} className="text-muted-foreground" />;
  };

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex w-full items-center py-1.5 px-2 cursor-pointer hover:bg-muted/50 text-sm select-none transition-colors group border-none bg-transparent",
          isSelected
            ? "bg-primary/10 text-primary font-medium"
            : "text-muted-foreground",
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => {
          if (isFile) {
            onSelect(node);
          } else {
            setIsOpen(!isOpen);
          }
        }}
      >
        {!isFile && (
          <span className="mr-1 opacity-50 group-hover:opacity-100 transition-opacity">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
        {isFile && <span className="mr-1 w-3" />}

        <span className="mr-2 opacity-80">
          {isFile ? (
            getFileIcon()
          ) : isOpen ? (
            <FolderOpen size={14} className="text-primary" />
          ) : (
            <Folder size={14} className="text-primary" />
          )}
        </span>
        <span className="truncate">{node.name}</span>
      </button>

      {!isFile && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};
