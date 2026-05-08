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
        "w-full text-left p-4 bg-card border border-card-border rounded-lg hover:border-primary/40 transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected ? "border-primary" : "",
        disabled
          ? "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={description}
    >
      <strong className="block">{title}</strong>
      <span className="text-sm text-muted-foreground">{description}</span>
    </button>
  );
}
