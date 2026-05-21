interface SpecConvertingStepProps {
  conversionError: string | null;
}

export function SpecConvertingStep({
  conversionError,
}: SpecConvertingStepProps) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Converting...</h2>
      <div className="p-4 bg-muted rounded flex items-center gap-3">
        <div className="animate-spin-border w-5 h-5 rounded-full border-2 border-primary border-t-transparent"></div>
        <p>Converting loose specification into structured architecture...</p>
      </div>
      {conversionError && (
        <div className="mt-4 p-4 bg-destructive/10 text-destructive rounded">
          Error: {conversionError}
        </div>
      )}
    </div>
  );
}
