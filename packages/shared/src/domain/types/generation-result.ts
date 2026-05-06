export interface GenerationResult {
  projectId: string;
  timestamp: number;
  files: Record<string, string>;
  manifestYaml: string;
  source: "local" | "cloud" | "server";
}
