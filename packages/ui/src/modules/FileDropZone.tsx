import {
  useState,
  useRef,
  type DragEvent,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "../elements/Icon.js";

export interface FileDropZoneProps {
  onFileLoaded: (content: string) => void;
  accept?: string;
  validateFile?: (file: File) => string | null;
  label?: string;
  hint?: ReactNode;
  className?: string;
}

export function FileDropZone({
  onFileLoaded,
  accept,
  validateFile,
  label = "Upload file — click or drop to browse",
  hint,
  className,
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    if (validateFile) {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }
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
    <div
      className={["flex flex-col items-center", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        role="button"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        aria-label={label}
        className={[
          "w-full border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/50",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Icon
          name="upload"
          size={32}
          className="mx-auto text-muted-foreground mb-3"
        />
        <p className="text-sm font-medium text-foreground">
          {hint ?? <>Drop a file here</>}
        </p>
        <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          aria-label={label}
          className="hidden"
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
