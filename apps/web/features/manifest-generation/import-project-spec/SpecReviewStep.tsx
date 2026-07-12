import type { SpecSummary } from "./utils";

interface SpecReviewStepProps {
  specSummary: SpecSummary | null;
  specContent: string;
  cameFromConversion: boolean;
  /** Advisory warnings from the conversion (e.g. suspected output truncation). */
  conversionWarnings?: string[];
  isJsonDisclosed: boolean;
  onToggleJsonDisclosed: (open: boolean) => void;
}

export function SpecReviewStep({
  specSummary,
  specContent,
  cameFromConversion,
  conversionWarnings = [],
  isJsonDisclosed,
  onToggleJsonDisclosed,
}: SpecReviewStepProps) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Spec Review</h2>
      {cameFromConversion && (
        <div className="mb-4 p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
          This summary was generated from your loose specification. Review the
          converted JSON below before generating ports and adapters.
        </div>
      )}
      {/* Conversion warnings originate ONLY from the loose-spec conversion, so
          gate them on `cameFromConversion`: a deterministic structured-config
          upload must never inherit a prior conversion's stale truncation
          warning (qodo #410). */}
      {cameFromConversion &&
        conversionWarnings.map((warning, i) => (
          <div
            key={`cw-${i}`}
            role="alert"
            className="mb-4 p-3 rounded border border-warning/40 bg-warning/10 text-sm"
          >
            {warning}
          </div>
        ))}
      {specSummary && (
        <div className="mb-4 space-y-2">
          <p>✓ {specSummary.contextCount} bounded contexts detected</p>
          <p>✓ {specSummary.aggregateCount} aggregates</p>
          <p>✓ {specSummary.valueObjectCount} value objects</p>
          <p>✓ {specSummary.useCaseCount} use cases</p>
          <p>✓ {specSummary.mappingCount} context mappings</p>
          {specSummary.eventBusSubscriptionCount > 0 && (
            <p>
              ✓ Event bus: {specSummary.eventBusSubscriptionCount} subscriptions
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-4">
            AI will generate: hexagonal ports, adapter assignments, manifest
            assembly, validation review
          </p>
          <p className="text-sm text-muted-foreground">
            AI will skip: domain extraction (Stage 1), context classification
            (Stage 2)
          </p>
          {specSummary.aggregateCount === 0 && (
            <div className="mt-4 p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
              No aggregates were detected. The generated ports will reference
              inferred aggregate names, so the port↔aggregate checks (R17)
              appear as advisory warnings rather than blocking errors. Add{" "}
              <code>aggregates</code> to your contexts if you want those checks
              enforced.
            </div>
          )}
        </div>
      )}
      {cameFromConversion && specContent && (
        <details
          className="mt-4 border rounded"
          open={isJsonDisclosed}
          onToggle={(e) =>
            onToggleJsonDisclosed((e.target as HTMLDetailsElement).open)
          }
        >
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            {isJsonDisclosed ? "Hide" : "View"} converted JSON
          </summary>
          <pre className="max-h-96 overflow-auto p-3 bg-muted text-xs font-mono whitespace-pre-wrap break-words">
            {specContent}
          </pre>
        </details>
      )}
    </div>
  );
}
