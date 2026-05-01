export function WarningBanner() {
  return (
    <div className="mb-4 mx-2 px-3 py-2.5 border-warning/30 bg-warning/10 dark:border-warning/40 dark:bg-warning/20 rounded-md">
      <p className="text-sm text-warning-foreground dark:text-warning-foreground/50 font-medium mb-1.5">
        A model is required
      </p>
      <p className="text-xs text-warning-foreground dark:text-warning-foreground/50">
        Please select and download a model to continue using the AI Governance
        panel.
      </p>
    </div>
  );
}
