import { Textarea } from "@hexagen/ui";

const MAX_LENGTH = 2000;
const MIN_LENGTH = 10;

interface DescriptionInputProps {
  value: string;
  onChange: (value: string) => void;
  charCount: number;
  disabled: boolean;
}

export function DescriptionInput({
  value,
  onChange,
  charCount,
  disabled,
}: DescriptionInputProps) {
  return (
    <section>
      <label
        htmlFor="description"
        className="block text-sm font-medium text-muted-foreground mb-2"
      >
        Project Description
      </label>
      <Textarea
        id="description"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Example: A task management system with user authentication, project boards, and real-time collaboration features..."
        className="w-full min-h-[var(--textarea-min-height)] bg-input border border-input rounded-md px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background resize-y"
        disabled={disabled}
      />
      <div className="flex justify-end mt-1">
        <span
          className={[
            "text-sm",
            charCount < MIN_LENGTH
              ? "text-muted-foreground"
              : charCount > MAX_LENGTH
                ? "text-destructive"
                : "text-success",
          ].join(" ")}
        >
          {charCount} / {MAX_LENGTH}
        </span>
      </div>
      {charCount < MIN_LENGTH && charCount > 0 && (
        <p className="text-sm text-muted-foreground mt-1">
          Minimum {MIN_LENGTH} characters required
        </p>
      )}
    </section>
  );
}
