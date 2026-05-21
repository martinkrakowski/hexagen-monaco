export function SpecDescriptionFallbackStep() {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Description Detected</h2>
      <p className="mb-4">
        Warning: This doesn't look like a structured spec. You can continue with
        AI generation using this as a description.
      </p>
    </div>
  );
}
