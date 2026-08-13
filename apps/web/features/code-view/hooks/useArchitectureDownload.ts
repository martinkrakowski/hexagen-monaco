"use client";

import { useCallback, useState } from "react";
import JSZip from "jszip";
import yaml from "js-yaml";
import type { WizardData } from "@hexagen/project-configuration";
import { wizardToManifest } from "@hexagen/wizard-orchestration";
import {
  isImportedFormState,
  parseImportedManifest,
} from "../../../app/lib/imported-manifest";

/**
 * Resolve the manifest.yaml content for the architecture ZIP. Pure and
 * exported for direct testing (the download itself needs DOM/blob plumbing).
 *
 * Import round-trip integrity (Item 1.3): this download has no server route —
 * it used to dump `wizardToManifest(wizardData)` unconditionally, which for an
 * imported project ships the DEGRADED projection while the rich manifest sits
 * in the saved record. For imported projects the saved YAML text is written
 * VERBATIM (validated first; re-dumping the parsed object would churn
 * formatting/comments for no gain), and a corrupt manifest FAILS CLOSED with a
 * blocking error rather than silently degrading. Wizard-authored projects keep
 * the projection path unchanged.
 */
export function resolveArchitectureManifestYaml(
  wizardData: WizardData,
  savedManifestYaml?: string | null,
): { ok: true; yamlContent: string } | { ok: false; message: string } {
  if (isImportedFormState(wizardData)) {
    const parsed = parseImportedManifest(savedManifestYaml);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    // parseImportedManifest guarantees a non-empty string here.
    return { ok: true, yamlContent: savedManifestYaml as string };
  }
  const manifest = wizardToManifest(wizardData);
  return { ok: true, yamlContent: yaml.dump(manifest, { lineWidth: -1 }) };
}

export function useArchitectureDownload(
  wizardData: WizardData,
  savedManifestYaml?: string | null,
) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadArchitectureZip = useCallback(async () => {
    if (isDownloading) return;

    const resolved = resolveArchitectureManifestYaml(
      wizardData,
      savedManifestYaml,
    );
    if (!resolved.ok) {
      setError(resolved.message);
      return;
    }

    setIsDownloading(true);
    setError(null);
    try {
      const zip = new JSZip();
      const archFolder = zip.folder(".architecture");
      archFolder?.file("manifest.yaml", resolved.yamlContent);

      const blob = await zip.generateAsync({ type: "blob" });
      const projectName =
        wizardData.governance?.workspaceName || "hexagen-project";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName}-architecture.zip`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } finally {
      setIsDownloading(false);
    }
  }, [wizardData, savedManifestYaml, isDownloading]);

  return { downloadArchitectureZip, isDownloading, error };
}
