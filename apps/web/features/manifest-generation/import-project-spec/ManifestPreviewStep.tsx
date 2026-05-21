import { CopyButton } from "@hexagen/ui";

interface ManifestPreviewStepProps {
  generatedManifest: string | null;
}

export function ManifestPreviewStep({
  generatedManifest,
}: ManifestPreviewStepProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <h2 className="text-xl font-semibold">Manifest Preview</h2>
        {generatedManifest && (
          <CopyButton
            text={generatedManifest}
            aria-label="Copy manifest YAML"
          />
        )}
      </div>
      {generatedManifest && (
        <pre className="flex-1 min-h-0 p-4 bg-muted rounded overflow-auto text-sm font-mono">
          {generatedManifest}
        </pre>
      )}
    </>
  );
}
