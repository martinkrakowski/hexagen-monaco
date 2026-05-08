import { ExampleCard } from "../ExampleCard";

const EXAMPLE_DESCRIPTIONS = [
  "A task management system with user authentication, project boards, and real-time collaboration features",
  "An e-commerce platform with product catalog, shopping cart, payment processing, and order management",
  "A blog platform with content management, user comments, and social sharing capabilities",
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {EXAMPLE_DESCRIPTIONS.map((example, index) => (
          <ExampleCard
            key={index}
            title={`Example ${index + 1}`}
            description={example}
            selected={selectedExample === index}
            disabled={isDisabled}
            onClick={() => onUseExample(example, index)}
          />
        ))}
      </div>
    </section>
  );
}
