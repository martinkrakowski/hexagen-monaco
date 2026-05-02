export interface ExampleCardProps {
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function ExampleCard({
  title,
  description,
  selected,
  disabled,
  onClick,
}: ExampleCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "bg-secondary border border-border rounded-md p-4 text-left transition-colors",
        "hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "active:brightness-90",
        selected ? "example-btn-active" : "",
        disabled
          ? "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={description}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="block w-1 h-1 rounded-full bg-primary" />
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed pl-3">
        {description}
      </p>
    </button>
  );
}
