import { Textarea, FileDropZone } from "@hexagen/ui";
import {
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
} from "@hexagen/agentic-interaction";
import { AiReadyIndicator } from "./AiReadyIndicator";

function formatCharCount(count: number, max: number): string {
  if (max >= 1_000_000)
    return `${(count / 1_000_000).toFixed(1)}M / ${(max / 1_000_000).toFixed(1)}M`;
  if (max >= 10_000)
    return `${count.toLocaleString()} / ${max.toLocaleString()}`;
  return `${count} / ${max}`;
}

interface DescriptionInputProps {
  value: string;
  onChange: (value: string) => void;
  charCount: number;
  disabled: boolean;
  isAiReady: boolean;
  loadedFileName: string | null;
  onLoadFromFile: (content: string, filename: string) => void;
  onClearFile: () => void;
}

export function DescriptionInput({
  value,
  onChange,
  charCount,
  disabled,
  isAiReady,
  loadedFileName,
  onLoadFromFile,
  onClearFile,
}: DescriptionInputProps) {
  const isTooShort = charCount > 0 && charCount < DESCRIPTION_MIN_LENGTH;
  const isTooLong = charCount > DESCRIPTION_MAX_LENGTH;

  return (
    <div className="space-y-2">
      <div className="bg-card border border-card-border rounded-lg textarea-glow">
        <div className="p-4 pb-2 flex items-center justify-between border-b border-card-border">
          <AiReadyIndicator isReady={isAiReady} />
          <span
            className={[
              "text-xs font-mono",
              isTooLong
                ? "text-destructive"
                : isTooShort
                  ? "text-amber-600"
                  : "text-muted-foreground",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {formatCharCount(charCount, DESCRIPTION_MAX_LENGTH)}
          </span>
        </div>
        {loadedFileName && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-card-border bg-muted/30">
            <span className="text-xs font-medium text-foreground truncate">
              {loadedFileName}
            </span>
            <button
              type="button"
              onClick={onClearFile}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              aria-label={`Remove ${loadedFileName}`}
            >
              ✕
            </button>
          </div>
        )}
        <Textarea
          id="description"
          aria-label="Project description"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe your project in detail... e.g., A task management system with user authentication, project boards, and real-time collaboration features..."
          className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/60 p-4 text-sm leading-relaxed resize-none focus:outline-none max-h-96 overflow-y-auto"
          disabled={disabled}
        />
      </div>
      {isTooShort && (
        <p className="text-sm text-muted-foreground">
          Minimum {DESCRIPTION_MIN_LENGTH} characters required
        </p>
      )}
      {isTooLong && (
        <p className="text-sm text-destructive">
          Description exceeds {DESCRIPTION_MAX_LENGTH.toLocaleString()}{" "}
          character limit
        </p>
      )}
      {!loadedFileName && (
        <FileDropZone
          onFileLoaded={onLoadFromFile}
          accept=".yaml,.yml,.json,.txt,.md"
          hint="Upload a config file to pre-fill description"
          className="text-xs"
        />
      )}
    </div>
  );
}
