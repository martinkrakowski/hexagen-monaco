"use client";

import { Checkbox } from "@hexagen/ui";
import type {
  SortField,
  SortState,
  ProjectListItem,
} from "../domain/project-list";
import { sortItems } from "../domain/project-list";
import { SortableColumnHeader } from "./SortableColumnHeader";
import { ProjectRow } from "./ProjectRow";

interface RenameOverlay {
  id: string;
  value: string;
}

interface ProjectsTableProps {
  items: readonly ProjectListItem[];
  sort: SortState;
  onToggleSort: (field: SortField) => void;
  isSelected: (id: string) => boolean;
  allSelected: (ids: readonly string[]) => boolean;
  onToggleSelect: (id: string) => void;
  onToggleAll: (ids: readonly string[], checked: boolean) => void;
  onLoadProject: (id: string) => void;
  onRequestRename: (id: string) => void;
  onRequestDelete: (id: string) => void;
  relativeTime: (ts: number) => string;
  shortDate: (ts: number) => string;
  renameOverlay: RenameOverlay | null;
  onUpdateRenameValue: (value: string) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
}

export function ProjectsTable({
  items,
  sort,
  onToggleSort,
  isSelected,
  allSelected,
  onToggleSelect,
  onToggleAll,
  onLoadProject,
  onRequestRename,
  onRequestDelete,
  relativeTime,
  shortDate,
  renameOverlay,
  onUpdateRenameValue,
  onCommitRename,
  onCancelRename,
}: ProjectsTableProps) {
  const sorted = sortItems(items, sort);
  const allIds = sorted.map((item) => item.id);
  const isAllSelected = allSelected(allIds);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full" role="grid">
        <thead className="bg-muted/50">
          <tr>
            <th className="w-10 px-3 py-2">
              <Checkbox
                checked={isAllSelected}
                onCheckedChange={(checked) =>
                  onToggleAll(allIds, checked === true)
                }
                aria-label="Select all projects"
              />
            </th>
            <SortableColumnHeader
              label="Name"
              field="name"
              currentSort={sort}
              onToggleSort={onToggleSort}
            />
            <SortableColumnHeader
              label="Updated"
              field="updated"
              currentSort={sort}
              onToggleSort={onToggleSort}
            />
            <SortableColumnHeader
              label="Created"
              field="created"
              currentSort={sort}
              onToggleSort={onToggleSort}
            />
            <th className="w-20 px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => (
            <ProjectRow
              key={item.id}
              item={item}
              isSelected={isSelected(item.id)}
              onToggleSelect={onToggleSelect}
              onLoadProject={onLoadProject}
              onRequestRename={onRequestRename}
              onRequestDelete={onRequestDelete}
              relativeTime={relativeTime}
              shortDate={shortDate}
              isRenaming={renameOverlay?.id === item.id}
              renameValue={
                renameOverlay?.id === item.id ? renameOverlay.value : undefined
              }
              onUpdateRenameValue={onUpdateRenameValue}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
