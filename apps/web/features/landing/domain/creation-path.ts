/** Top-level creation path identifiers */
export type CreationPathId = "blank" | "import" | "ai";

/** A top-level creation option shown on the landing page */
export interface CreationPathOption {
  readonly id: CreationPathId;
  readonly label: string;
  readonly description: string;
  readonly colorTheme: "success" | "info" | "primary";
  readonly iconName: string;
  readonly isRecommended: boolean;
  readonly href: string;
}

/** Sub-option identifiers for the import creation path */
export type ImportSubOptionId = "spec" | "scan" | "artifacts" | "github";

/** A selectable import sub-option under the import creation path */
export interface ImportSubOption {
  readonly id: ImportSubOptionId;
  readonly label: string;
  readonly description: string;
  readonly detail: string;
  readonly href: string;
  readonly iconName: string;
  readonly status: "available" | "coming-soon";
}

/**
 * Pre-defined import sub-options: a unified file import (manifest or spec),
 * zip scan, Tier-A scan-artifact upload, and GitHub import.
 */
export const IMPORT_SUB_OPTIONS: readonly ImportSubOption[] = [
  {
    id: "spec",
    label: "Import Manifest or Spec",
    description:
      "Upload a generated manifest.yaml or a structured domain spec you have authored.",
    detail:
      "We auto-detect the format: a complete manifest goes straight to review, while a spec is mapped to hexagonal ports and adapters by AI first.",
    // Route through the shared Project Name step first; it forwards the entered
    // name to the importer via `?name=`. The importer auto-detects manifest vs spec.
    href: "/projects/new/name?path=spec",
    iconName: "FileCode",
    status: "available",
  },
  {
    id: "scan",
    label: "Scan existing project",
    description:
      "Upload a zip of a TypeScript repo. We map workspaces, write a layout, optionally bootstrap a manifest, and run hexagen-lint.",
    detail:
      "Assisted brownfield adoption — not automated ingestion, not inference. You ratify by uploading; the engine does not guess depends_on from the import graph.",
    href: "/projects/new/name?path=scan",
    iconName: "FolderSearch",
    status: "available",
  },
  {
    id: "artifacts",
    label: "Upload scan artifacts",
    description:
      "Run the scan locally with `hexagen scan --handoff` and upload only the handoff zip. Your source never leaves your machine.",
    detail:
      "Privacy tier A: we receive the manifest, layout, baseline, report and ledger — nothing else — and parse them in place. The path for client engagements where the repo cannot be uploaded.",
    // Routes through the shared Project Name step, which forwards the entered
    // name to the artifact importer via `?name=`.
    href: "/projects/new/name?path=artifacts",
    iconName: "Braces",
    // Available since BF-3.3 mounted /projects/new/import/artifacts (the real
    // Tier-A screen, replacing the placeholder that redirected here). The name
    // step forwards `?name=` to it, so both legs of this href now terminate on
    // a real screen. `creation-path.test.ts` asserts this in both directions —
    // see NOT_YET_ROUTED there.
    status: "available",
  },
  {
    id: "github",
    label: "Scan a public GitHub repository",
    description:
      "Give us a public repository URL. We shallow-clone it, scan it, and delete the clone.",
    detail:
      "Privacy tier B: your source is fetched by our server, so the repository has to be public and this is not the path for client engagements. Nothing is retained but the scan artifacts.",
    href: "/projects/new/import/github",
    iconName: "Github",
    // Available since BF-5.3 mounted /projects/new/import/github (the real
    // Tier-B repo-entry and streaming-scan screen, replacing the placeholder
    // that redirected back to the import list). `creation-path.test.ts` asserts
    // this in both directions — see NOT_YET_ROUTED there.
    //
    // The label and description above changed with it, and not cosmetically:
    // they previously promised an OAuth connection and architecture
    // extraction, which is not what shipped. What shipped is an anonymous
    // shallow clone of a PUBLIC repository — no OAuth, no private access — and
    // an option that oversells its own privacy posture is the one kind of
    // stale copy this product cannot carry.
    status: "available",
  },
] as const;

/** Classified input mode after content inspection */
export type InputMode = "manifest" | "structured-config" | "unknown";

/**
 * Detect whether raw content represents a manifest, structured config, or is unrecognisable.
 * Uses file extension heuristics then falls back to content inspection.
 */
export function detectInputMode(content: string, filename?: string): InputMode {
  const ext = filename?.toLowerCase().split(".").pop();
  if (ext === "yaml" || ext === "yml") {
    if (content.trim().startsWith("{") || content.trim().startsWith("[")) {
      try {
        JSON.parse(content.trim());
        return "structured-config";
      } catch {
        return "unknown";
      }
    }
    return "manifest";
  }
  if (ext === "json") {
    return "structured-config";
  }
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "structured-config";
    } catch {
      return "unknown";
    }
  }
  if (/^\s*[\w-]+:/.test(trimmed)) {
    return "manifest";
  }
  return "unknown";
}

/** A labelled step in a multi-step creation flow */
export interface StepLabel {
  readonly label: string;
  readonly step: number;
}

/** Pre-defined creation path options: blank, import, and AI generation */
export const CREATION_PATH_OPTIONS: readonly CreationPathOption[] = [
  {
    id: "blank",
    label: "Start Blank",
    description:
      "Begin with a clean manifest. Define every bounded context, aggregate, and domain event from scratch.",
    colorTheme: "success",
    iconName: "FileText",
    isRecommended: false,
    href: "",
  },
  {
    id: "import",
    label: "Import",
    description:
      "Import an existing manifest, upload a structured domain spec, or scan a zip of a TypeScript repo.",
    colorTheme: "info",
    iconName: "Upload",
    isRecommended: false,
    href: "/projects/new/import",
  },
  {
    id: "ai",
    label: "Generate with AI",
    description:
      "Describe your project in natural language. AI generates a complete DDD-aligned manifest in seconds.",
    colorTheme: "primary",
    iconName: "Layers",
    isRecommended: true,
    href: "/projects/new/ai",
  },
] as const;

/** Static step labels used by the creation flow step indicator */
export const CREATION_STEPS: readonly StepLabel[] = [
  { label: "Method", step: 1 },
  { label: "Configure", step: 2 },
  { label: "Generate", step: 3 },
] as const;
