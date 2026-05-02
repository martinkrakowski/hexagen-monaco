import yaml from "js-yaml";
import type { ManifestOutput } from "./draft-to-manifest.transform.js";
import type {
  RenderedManifest,
  DraftDiagnostic,
} from "./manifest-draft.types.js";

async function computeToken(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const YAML_DUMP_OPTIONS: yaml.DumpOptions = {
  indent: 2,
  lineWidth: -1,
  noRefs: true,
  sortKeys: false,
  quotingType: '"',
  forceQuotes: false,
  skipInvalid: false,
};

export function renderManifestYaml(manifest: ManifestOutput): string {
  return yaml.dump(manifest, YAML_DUMP_OPTIONS);
}

export async function renderDraft(
  manifest: ManifestOutput,
  diagnostics: DraftDiagnostic[],
): Promise<RenderedManifest> {
  const yamlStr = renderManifestYaml(manifest);
  const token = await computeToken(yamlStr);
  return {
    yaml: yamlStr,
    diagnostics,
    token,
  };
}

export async function verifyToken(
  yamlContent: string,
  token: string,
): Promise<boolean> {
  const computed = await computeToken(yamlContent);
  return computed === token;
}
