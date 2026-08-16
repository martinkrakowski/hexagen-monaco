import type { SavedProject } from "@/hooks/useSavedProjects";
import { collapseApplications } from "@/applications-config";
import {
  apiFrameworkOptions,
  uiFrameworkOptions,
} from "@/project-config-options";

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
  readonly namespace: string;
  readonly boundedContextNames: readonly string[];
  readonly boundedContextCount: number;
  readonly apiLabel: string;
  readonly uiLabel: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sortName: string;
  readonly sortUpdated: number;
  readonly sortCreated: number;
}

/** Compact column label for the project-level API backend target. */
function apiTargetLabel(target: string): string {
  if (target === "none") return "None";
  return apiFrameworkOptions.find((o) => o.value === target)?.label ?? target;
}

/** Compact column label for the project-level UI framework (headless = ""). */
function uiFrameworkLabel(framework: string): string {
  if (framework === "") return "Headless";
  return (
    uiFrameworkOptions.find((o) => o.value === framework)?.label ?? framework
  );
}

export function toProjectListItem(project: SavedProject): ProjectListItem {
  const governance = project.formState?.governance as
    | { workspaceDescription?: string; namespacePrefix?: string }
    | undefined;

  // Saved projects can be drifted (Path 4 preserves them verbatim at the IDB
  // load perimeter), so coerce a non-array `boundedContexts` and keep only
  // object entries before reading them — same caution as wizard-to-manifest.
  const rawContexts = project.formState?.boundedContexts;
  const contexts = (Array.isArray(rawContexts) ? rawContexts : []).filter(
    (c): c is NonNullable<typeof c> => !!c && typeof c === "object",
  );
  const boundedContextNames = contexts
    .filter((c) => typeof (c as { name?: unknown }).name === "string")
    .map((c) => (c as { name: string }).name);

  const apps = collapseApplications(contexts);

  return {
    id: project.id,
    name: project.name,
    description: governance?.workspaceDescription ?? "",
    namespace: governance?.namespacePrefix || "@hexagen",
    boundedContextNames,
    boundedContextCount: boundedContextNames.length,
    apiLabel: apiTargetLabel(apps.infrastructureTarget),
    uiLabel: uiFrameworkLabel(apps.uiFramework),
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
      default: {
        const _exhaustive: never = field;
        throw new Error(`Unhandled sort field: ${_exhaustive}`);
      }
    }
    return cmp * multiplier;
  });

  return sorted;
}
