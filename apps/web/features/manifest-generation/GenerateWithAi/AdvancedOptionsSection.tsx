import { Label, Input } from "@hexagen/ui";
import { DEFAULT_MAX_BOUNDED_CONTEXTS } from "@hexagen/agentic-interaction";

const MIN_CONTEXTS = 1;
const MAX_CONTEXTS = 25;

interface AdvancedOptionsSectionProps {
  platform: string;
  onPlatformChange: (value: string) => void;
  deployment: string;
  onDeploymentChange: (value: string) => void;
  maxContexts: number;
  onMaxContextsChange: (value: number) => void;
  isDisabled: boolean;
}

export function AdvancedOptionsSection({
  platform,
  onPlatformChange,
  deployment,
  onDeploymentChange,
  maxContexts,
  onMaxContextsChange,
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="maxContexts">Max Bounded Contexts</Label>
              <span className="text-sm font-mono text-muted-foreground tabular-nums">
                {maxContexts}
              </span>
            </div>
            <input
              id="maxContexts"
              type="range"
              min={MIN_CONTEXTS}
              max={MAX_CONTEXTS}
              value={maxContexts}
              onChange={(e) => onMaxContextsChange(Number(e.target.value))}
              disabled={isDisabled}
              className="w-full h-2 rounded-full appearance-none bg-input cursor-pointer accent-primary disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{MIN_CONTEXTS}</span>
              <span>Default: {DEFAULT_MAX_BOUNDED_CONTEXTS}</span>
              <span>{MAX_CONTEXTS}</span>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}
