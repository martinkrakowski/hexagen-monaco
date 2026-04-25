import { FileDropZone } from "@hexagen/ui";

interface ManifestFileDropZoneProps {
  onFileLoaded: (content: string) => void;
  className?: string;
}

export function ManifestFileDropZone({
  onFileLoaded,
  className,
}: ManifestFileDropZoneProps) {
  return (
    <FileDropZone
      onFileLoaded={onFileLoaded}
      accept=".yaml,.yml"
      validateFile={(file) => {
        if (!file.name.match(/\.(ya?ml)$/i)) {
          return "Please select a .yaml or .yml file";
        }
        return null;
      }}
      label="Upload manifest YAML file — click or drop to browse"
      hint={
        <>
          Drop a{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">
            manifest.yaml
          </code>{" "}
          file here
        </>
      }
      className={className}
    />
  );
}
