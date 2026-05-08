export type CreationPathId = "blank" | "import" | "ai";

export interface CreationPathOption {
  readonly id: CreationPathId;
  readonly label: string;
  readonly description: string;
  readonly colorTheme: "success" | "info" | "primary";
  readonly iconName: string;
  readonly isRecommended: boolean;
  readonly href: string;
}

export interface StepLabel {
  readonly label: string;
  readonly step: number;
}

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
    label: "Import Manifest",
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

export const CREATION_STEPS: readonly StepLabel[] = [
  { label: "Method", step: 1 },
  { label: "Configure", step: 2 },
  { label: "Generate", step: 3 },
] as const;
