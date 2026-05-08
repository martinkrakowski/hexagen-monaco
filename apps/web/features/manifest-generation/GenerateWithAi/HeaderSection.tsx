import type { HeaderSectionProps } from "./types";

export function HeaderSection({ title, subtitle }: HeaderSectionProps) {
  return (
    <div className="mb-8 animate-fade-in-up">
      <h1 className="text-4xl font-bold tracking-tight mb-2 text-foreground">
        {title}
      </h1>
      <p className="text-muted-foreground text-lg">{subtitle}</p>
    </div>
  );
}
