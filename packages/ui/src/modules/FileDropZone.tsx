import { useState, useRef, type DragEvent, type ChangeEvent, type KeyboardEvent } from "react";
import { Icon } from "../elements/Icon";

export interface FileDropZoneProps {
  onFileLoaded: (content: string) => void;
  accept?: string;
  className?: string;
}

export function FileDropZone({
  onFileLoaded,
  accept = ".yaml,.yml",
  className,
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    if (!file.name.match(/\.(ya?ml)$/i)) {
      setError("Please select a .yaml or .yml file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      if (typeof content === "string") {
        setError(null);
        onFileLoaded(content);
      }
    };
    reader.onerror = () => setError("Failed to read file");
    reader.readAsText(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div className={["flex flex-col items-center", className]
      .filter(Boolean)
      .join(" ")}>
      <div
        role="button"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        aria-label="Upload manifest YAML file — click or drop to browse"
        className={[
          "w-full border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-bg-tertiary/50",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Icon
          name="upload"
          size={32}
          className="mx-auto text-text-tertiary mb-3"
        />
        <p className="text-sm font-medium text-text-primary">
          Drop a{" "}
          <code className="text-xs bg-bg-tertiary px-1 py-0.5 rounded">
            manifest.yaml
          </code>{" "}
          file here
        </p>
        <p className="text-xs text-text-tertiary mt-1">or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          aria-label="Upload manifest file"
          className="hidden"
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-error mt-2">
          {error}
        </p>
      )}
    </div>
  );
}