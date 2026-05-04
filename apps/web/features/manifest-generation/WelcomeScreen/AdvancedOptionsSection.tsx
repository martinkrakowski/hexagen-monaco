import { Label, Input } from "@hexagen/ui";

interface AdvancedOptionsSectionProps {
  platform: string;
  onPlatformChange: (value: string) => void;
  deployment: string;
  onDeploymentChange: (value: string) => void;
  isDisabled: boolean;
}

export function AdvancedOptionsSection({
  platform,
  onPlatformChange,
  deployment,
  onDeploymentChange,
  isDisabled,
}: AdvancedOptionsSectionProps) {
  return (
    <section className="border-t border-border pt-4">
      <details className="group">
        <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm">
          Advanced Options
          <svg
            className="w-4 h-4 transition-transform duration-200 group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </summary>
        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="platform">Platform (optional)</Label>
            <Input
              id="platform"
              value={platform}
              onChange={(e) => onPlatformChange(e.target.value)}
              placeholder="e.g., Node.js, Python, Java"
              disabled={isDisabled}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="deployment">Deployment (optional)</Label>
            <Input
              id="deployment"
              value={deployment}
              onChange={(e) => onDeploymentChange(e.target.value)}
              placeholder="e.g., AWS, Docker, Kubernetes"
              disabled={isDisabled}
            />
          </div>
        </div>
      </details>
    </section>
  );
}
