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
  readonly iconName: string;
  readonly href: string;
  readonly isAvailable: boolean;
}

/** Pre-defined import sub-options: manifest upload, structured config, and GitHub import */
export const IMPORT_SUB_OPTIONS: readonly ImportSubOption[] = [
  {
    id: "manifest",
    label: "Import Manifest",
    description:
      "Upload a manifest.yaml file. Resume work or adapt a previously generated architecture.",
    iconName: "FileText",
    href: "/projects/new/import/manifest",
    isAvailable: true,
  },
  {
    id: "spec",
    label: "Import Structured Config",
    description:
      "Upload a structured config (JSON/YAML). AI maps ports and adapters, then assembles a manifest.",
    iconName: "Braces",
    href: "/projects/new/import/spec",
    isAvailable: true,
  },
  {
    id: "github",
    label: "Import from GitHub",
    description:
      "Clone a repository and extract architecture from code. Coming soon.",
    iconName: "GitBranch",
    href: "/projects/new/import/github",
    isAvailable: false,
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
      "Upload an existing manifest file. Resume work or adapt a previously generated architecture.",
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
