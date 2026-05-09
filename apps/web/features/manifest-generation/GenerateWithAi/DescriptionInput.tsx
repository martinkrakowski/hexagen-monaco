import { Textarea } from "@hexagen/ui";
import { AiReadyIndicator } from "./AiReadyIndicator";

const MAX_LENGTH = 2000;
const MIN_LENGTH = 10;

interface DescriptionInputProps {
  value: string;
  onChange: (value: string) => void;
  charCount: number;
  disabled: boolean;
  isAiReady: boolean;
}

export function DescriptionInput({
  value,
  onChange,
  charCount,
  disabled,
  isAiReady,
}: DescriptionInputProps) {
  return (
    <div>
      <div className="bg-card border border-card-border rounded-lg textarea-glow">
        <div className="p-4 pb-2 flex items-center justify-between border-b border-card-border">
          <AiReadyIndicator isReady={isAiReady} />
          <span className="text-xs font-mono text-muted-foreground">
            {charCount} / {MAX_LENGTH}
          </span>
        </div>
        <Textarea
          id="description"
          aria-label="Project description"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe your project in detail... e.g., A task management system with user authentication, project boards, and real-time collaboration features..."
          className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/60 p-4 text-sm leading-relaxed resize-none focus:outline-none h-48"
          disabled={disabled}
        />
      </div>
      {charCount < MIN_LENGTH && charCount > 0 && (
        <p className="text-sm text-muted-foreground mt-1">
          Minimum {MIN_LENGTH} characters required
        </p>
      )}
    </div>
  );
}
