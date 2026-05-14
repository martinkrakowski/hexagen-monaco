"use client";

import React, { memo, useRef, useEffect } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Checkbox } from "@hexagen/ui";
import { Button } from "@hexagen/ui";
import type { ProjectListItem } from "../domain/project-list";

interface ProjectRowProps {
  item: ProjectListItem;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onLoadProject: (id: string) => void;
  onRequestRename: (id: string) => void;
  onRequestDelete: (id: string) => void;
  relativeTime: (ts: number) => string;
  shortDate: (ts: number) => string;
  isRenaming?: boolean;
  renameValue?: string;
  onUpdateRenameValue?: (value: string) => void;
  onCommitRename?: (id: string) => void;
  onCancelRename?: () => void;
}

export const ProjectRow = memo(function ProjectRow({
  item,
  isSelected,
  onToggleSelect,
  onLoadProject,
  onRequestRename,
  onRequestDelete,
  relativeTime,
  shortDate,
  isRenaming = false,
  renameValue,
  onUpdateRenameValue,
  onCommitRename,
  onCancelRename,
}: ProjectRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isCancellingRef = useRef(false);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && onCommitRename) {
      onCommitRename(item.id);
    } else if (e.key === "Escape" && onCancelRename) {
      isCancellingRef.current = true;
      onCancelRename();
    }
  };

  return (
    <tr className="group border-b border-border transition-colors hover:bg-accent/30 h-12">
      <td className="w-10 px-3 py-2">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(item.id)}
          aria-label={`Select ${item.name}`}
        />
      </td>
      <td className="px-3 py-2">
        <div className="min-w-0">
          {isRenaming ? (
            <input
              ref={inputRef}
              type="text"
              value={renameValue ?? item.name}
              onChange={(e) => onUpdateRenameValue?.(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (isCancellingRef.current) {
                  isCancellingRef.current = false;
                  return;
                }
                onCommitRename?.(item.id);
              }}
              className="text-sm bg-background border border-ring rounded px-2 py-1 w-full max-w-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Rename ${item.name}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => onLoadProject(item.id)}
              className="text-primary hover:underline cursor-pointer text-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {item.name}
            </button>
          )}
          <p className="text-xs text-muted-foreground truncate max-w-md hidden sm:block">
            {item.description}
          </p>
        </div>
      </td>
      <td className="w-32 px-3 py-2 text-sm text-muted-foreground hidden md:table-cell">
        {relativeTime(item.updatedAt)}
      </td>
      <td className="w-32 px-3 py-2 text-sm text-muted-foreground hidden lg:table-cell">
        {shortDate(item.createdAt)}
      </td>
      <td className="w-20 px-3 py-2">
        <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRequestRename(item.id)}
            aria-label={`Rename ${item.name}`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRequestDelete(item.id)}
            aria-label={`Delete ${item.name}`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
});
