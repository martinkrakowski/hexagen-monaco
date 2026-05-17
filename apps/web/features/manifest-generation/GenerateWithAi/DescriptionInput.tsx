import { Textarea, FileDropZone } from "@hexagen/ui";
import {
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} from "@hexagen/agentic-interaction";
import { AiReadyIndicator } from "./AiReadyIndicator";

interface DescriptionInputProps {
  value: string;
  onChange: (value: string) => void;
  charCount: number;
  disabled: boolean;
  isAiReady: boolean;
  loadedFileName?: string | null;
  onFileLoaded?: (content: string, filename: string) => void;
  onClearFile?: () => void;
}

/** Textarea with file-upload overlay, character counter, and filename badge */
export function DescriptionInput({
  value,
  onChange,
  charCount,
  disabled,
  isAiReady,
  loadedFileName,
  onFileLoaded,
  onClearFile,
}: DescriptionInputProps) {
  const ACCEPTED_EXTENSIONS = [
    ".yaml",
    ".yml",
    ".toml",
    ".json",
    ".md",
    ".txt",
  ];

  const validateFile = (file: File): string | null => {
    const lower = file.name.toLowerCase();
    const ok = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    return ok
      ? null
      : `Unsupported type. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`;
  };

  const isNearLimit = charCount > DESCRIPTION_MAX_LENGTH * 0.9;
  const isAtLimit = charCount >= DESCRIPTION_MAX_LENGTH;
  const isTooShort = charCount > 0 && charCount < DESCRIPTION_MIN_LENGTH;
  const counterClass = isAtLimit
    ? "text-destructive font-semibold"
    : isNearLimit
      ? "text-amber-500"
      : "text-muted-foreground";

  return (
    <div>
      {/* ① Upload zone — hidden when loadedFileName is set */}
      <div className={loadedFileName ? "hidden" : ""}>
        <FileDropZone
          accept=".yaml,.yml,.toml,.json,.md,.txt"
          validateFile={validateFile}
          onFileLoaded={(content, filename) =>
            onFileLoaded?.(content, filename)
          }
          label="Upload a project config — click or drop to browse"
          hint={<>Drop a .yaml, .md, .json, or .txt config</>}
        />
      </div>

      {/* ② Filename badge — shown when loadedFileName is non-null */}
      {loadedFileName && (
        <div
          role="status"
          className="flex items-center gap-2 px-3 py-2 rounded-md border border-info/30 bg-info/10 text-info text-sm"
        >
          <span className="shrink-0">📄</span>
          <span className="flex-1 truncate font-medium">{loadedFileName}</span>
          <button
            type="button"
            onClick={onClearFile}
            aria-label="Remove loaded file"
            className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          >
            ✕
          </button>
        </div>
      )}

      {/* ③ Divider — shown when file is loaded */}
      {loadedFileName && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex-1 border-t border-border" />
          <span>Edit below if needed</span>
          <div className="flex-1 border-t border-border" />
        </div>
      )}

      {/* ④ Existing textarea card — update Textarea className only */}
      <div className="bg-card border border-card-border rounded-lg textarea-glow">
        <div className="p-4 pb-2 flex items-center justify-between border-b border-card-border">
          <AiReadyIndicator isReady={isAiReady} />
          <span
            aria-live="polite"
            aria-atomic="true"
            className={counterClass}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {charCount.toLocaleString()} /{" "}
            {DESCRIPTION_MAX_LENGTH.toLocaleString()}
          </span>
        </div>
        <Textarea
          id="description"
          aria-label="Project description"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe your project in detail... e.g., A task management system with user authentication, project boards, and real-time collaboration features..."
          className="description-textarea w-full bg-transparent text-foreground placeholder:text-muted-foreground/60 p-4 text-sm leading-relaxed resize-y focus:outline-none overflow-y-auto min-h-32 max-h-100"
          disabled={disabled}
        />
      </div>

      {/* ⑤ Too-short helper text */}
      {isTooShort && (
        <p className="text-sm text-muted-foreground mt-1">
          Minimum {DESCRIPTION_MIN_LENGTH} characters required
        </p>
      )}
    </div>
  );
}
