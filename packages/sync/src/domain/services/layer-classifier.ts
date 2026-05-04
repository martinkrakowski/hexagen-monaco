import type { Layer } from "./impact-analysis.types.js";

export function determineLayer(relativePath: string): Layer {
  if (relativePath.includes("/__tests__/")) {
    return "test";
  }
  if (relativePath.includes("/domain/")) {
    return "domain";
  }
  if (relativePath.includes("/application/")) {
    return "application";
  }
  if (relativePath.includes("/infrastructure/")) {
    return "infrastructure";
  }
  if (relativePath.includes(".architecture/manifest.yaml")) {
    return "manifest";
  }
  if (
    relativePath.includes("tsconfig") ||
    relativePath.includes("package.json")
  ) {
    return "config";
  }
  return "unknown";
}

export function determinePackageName(relativePath: string): string {
  const match = relativePath.match(/^(?:packages|apps)\/([^/]+)/);
  return match ? match[1] : "unknown";
}
