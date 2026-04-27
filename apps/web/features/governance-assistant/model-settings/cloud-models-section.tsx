interface CloudModelsSectionProps {
  onSwitchToCloud?: () => void;
}

export function CloudModelsSection({
  onSwitchToCloud,
}: CloudModelsSectionProps) {
  return (
    <div className="mb-6">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase mb-3">
        Cloud Models
      </h2>
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-foreground">
                Use Cloud LLM
              </h3>
              <span className="inline-flex items-center rounded-full bg-blue/10 px-1.5 py-0.5 text-xs font-medium text-blue shrink-0">
                OpenAI
              </span>
              <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground/80 shrink-0">
                Anthropic · Mistral · Google (coming soon)
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Connect to GPT-4o, GPT-4o Mini, and other cloud models with your
              own API key. Keys are sent per request and never stored.
            </p>
          </div>
          <button
            onClick={onSwitchToCloud}
            disabled={!onSwitchToCloud}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {onSwitchToCloud ? "Connect" : "Open in Local panel"}
          </button>
        </div>
      </div>
    </div>
  );
}
