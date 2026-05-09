import { ExampleCard } from "../ExampleCard";

const EXAMPLE_DESCRIPTIONS: { title: string; description: string }[] = [
  {
    title: "Task Management System",
    description: "Kanban boards, team assignments, real-time collaboration...",
  },
  {
    title: "E-Commerce Platform",
    description: "Product catalog, payments, inventory, multi-vendor...",
  },
];

interface ExampleCardsSectionProps {
  selectedExample: number | null;
  onUseExample: (example: string, index: number) => void;
  isDisabled: boolean;
}

export function ExampleCardsSection({
  selectedExample,
  onUseExample,
  isDisabled,
}: ExampleCardsSectionProps) {
  return (
    <section>
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        Quick Examples
      </h3>
      <div className="space-y-3">
        {EXAMPLE_DESCRIPTIONS.map((example, index) => (
          <ExampleCard
            key={index}
            title={example.title}
            description={example.description}
            selected={selectedExample === index}
            disabled={isDisabled}
            onClick={() => onUseExample(example.description, index)}
          />
        ))}
      </div>
    </section>
  );
}
