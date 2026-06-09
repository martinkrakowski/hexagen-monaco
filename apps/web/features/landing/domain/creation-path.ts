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
export type ImportSubOptionId = "manifest" | "spec" | "github";

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

/** Pre-defined import sub-options: manifest upload, structured config, and GitHub import */
export const IMPORT_SUB_OPTIONS: readonly ImportSubOption[] = [
  {
    id: "manifest",
    label: "Import Manifest YAML",
    description:
      "Resume or adapt a previously generated hexagen manifest.yaml.",
    detail: "No AI involved — direct schema parse and load.",
    // Route through the shared Project Name step first; it forwards the entered
    // name to the manifest importer via `?name=`.
    href: "/projects/new/name?path=manifest",
    iconName: "FileCode",
    status: "available",
  },
  {
    id: "spec",
    label: "Import Project Specification",
    description:
      "Upload a structured YAML or JSON domain spec you have already authored.",
    detail:
      "AI maps your bounded contexts to hexagonal ports and adapters. Domain derivation is skipped.",
    // Route through the shared Project Name step first; it forwards the entered
    // name to the spec importer via `?name=`.
    href: "/projects/new/name?path=spec",
    iconName: "Braces",
    status: "available",
  },
  {
    id: "github",
    label: "Import from GitHub",
    description:
      "Connect a repository and extract its existing architecture as a starting point.",
    detail: "OAuth connection and repository analysis.",
    href: "/projects/new/import/github",
    iconName: "Github",
    status: "coming-soon",
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
      "Import an existing manifest, upload a structured domain spec, or connect a GitHub repository.",
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
