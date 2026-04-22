export function WarningBanner() {
  return (
    <div className="mb-4 mx-2 px-3 py-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
      <p className="text-sm text-amber-800 dark:text-amber-200 font-medium mb-1.5">
        A model is required
      </p>
      <p className="text-xs text-amber-700 dark:text-amber-300">
        Please select and download a model to continue using the AI Governance
        panel.
      </p>
    </div>
  );
}
