import type { ChangeEvent } from "react";

interface SpecUploadStepProps {
  onFileLoaded: (content: string) => void;
}

export function SpecUploadStep({ onFileLoaded }: SpecUploadStepProps) {
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === "string") {
        onFileLoaded(ev.target.result);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Import Manifest or Spec</h1>
      <p className="mb-4">
        Upload a generated manifest.yaml or a structured domain spec — we detect
        which and route accordingly.
      </p>
      <label
        htmlFor="project-spec-file"
        className="block mb-2 text-sm font-medium"
      >
        Upload manifest or spec
      </label>
      <input
        id="project-spec-file"
        type="file"
        accept=".yaml,.yml,.json,.txt,.md"
        aria-describedby="file-help"
        onChange={handleFileChange}
        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-accent file:text-accent-foreground hover:file:bg-accent/90"
      />
      <p id="file-help" className="text-sm text-muted-foreground mt-2">
        Accepts .yaml, .yml, .json, .txt, or .md — a generated manifest, a
        structured spec, or a prose description (we detect which and route
        accordingly).
      </p>
    </div>
  );
}
