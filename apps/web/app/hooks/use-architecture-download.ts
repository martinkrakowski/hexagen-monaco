"use client";

import { useCallback, useState } from "react";
import JSZip from "jszip";
import yaml from "js-yaml";
import type { WizardData } from "@hexagen/shared";
import { wizardToManifest } from "@/lib/wizard-to-manifest";

export function useArchitectureDownload(wizardData: WizardData) {
  const [isDownloading, setIsDownloading] = useState(false);

  const downloadArchitectureZip = useCallback(async () => {
    if (isDownloading) return;

    setIsDownloading(true);
    try {
      const manifest = wizardToManifest(wizardData);
      const yamlContent = yaml.dump(manifest, { lineWidth: -1 });

      const zip = new JSZip();
      const archFolder = zip.folder(".architecture");
      archFolder?.file("manifest.yaml", yamlContent);

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
  }, [wizardData, isDownloading]);

  return { downloadArchitectureZip, isDownloading };
}
