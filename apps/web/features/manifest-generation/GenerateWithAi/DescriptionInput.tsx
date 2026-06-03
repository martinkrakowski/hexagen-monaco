import { Textarea } from "@hexagen/ui";
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
}

/** Textarea with character counter and AI-ready indicator. File import lives in
 * the dedicated import flow, not here. */
export function DescriptionInput({
  value,
  onChange,
  charCount,
  disabled,
  isAiReady,
}: DescriptionInputProps) {
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

      {isTooShort && (
        <p className="text-sm text-muted-foreground mt-1">
          Minimum {DESCRIPTION_MIN_LENGTH} characters required
        </p>
      )}
    </div>
  );
}
