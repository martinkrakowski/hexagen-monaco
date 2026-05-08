import type { SavedProject } from "@/hooks/useSavedProjects";

export type SortField = "name" | "updated" | "created";
export type SortDirection = "asc" | "desc";

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

export interface ProjectListItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sortName: string;
  readonly sortUpdated: number;
  readonly sortCreated: number;
}

export function toProjectListItem(project: SavedProject): ProjectListItem {
  const governance = project.formState?.governance as
    | { workspaceDescription?: string }
    | undefined;
  return {
    id: project.id,
    name: project.name,
    description: governance?.workspaceDescription ?? "",
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sortName: project.name.toLowerCase(),
    sortUpdated: project.updatedAt,
    sortCreated: project.createdAt,
  };
}

export function sortItems(
  items: readonly ProjectListItem[],
  state: SortState,
): ProjectListItem[] {
  const sorted = [...items];
  const { field, direction } = state;
  const multiplier = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    let cmp: number;
    switch (field) {
      case "name":
        cmp = a.sortName.localeCompare(b.sortName);
        break;
      case "updated":
        cmp = a.sortUpdated - b.sortUpdated;
        break;
      case "created":
        cmp = a.sortCreated - b.sortCreated;
        break;
    }
    return cmp * multiplier;
  });

  return sorted;
}
