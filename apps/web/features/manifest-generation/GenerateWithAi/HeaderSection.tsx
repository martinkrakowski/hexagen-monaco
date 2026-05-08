import type { HeaderSectionProps } from "./types";

export function HeaderSection({ title, subtitle }: HeaderSectionProps) {
  return (
    <header className="mb-8 text-center animate-fade-in-up">
      <h1 className="text-4xl font-bold mb-3 text-foreground">{title}</h1>
      <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
        {subtitle}
      </p>
    </header>
  );
}
