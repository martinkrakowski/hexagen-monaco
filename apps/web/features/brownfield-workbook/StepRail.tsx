import { cleanText } from "@hexagen/shared";
import { CopyCommandButton } from "./CopyCommandButton";
import type { StepView } from "./steps";

/** Every string from a bundle is untrusted: control characters stripped, then rendered as React text. */
export const safe = (text: string): string => cleanText(text);

function EvidenceDetail({ step }: { readonly step: StepView }) {
  const ev = step.evidence;
  if (ev === undefined) return null;
  return (
    <div className="mt-2 space-y-2 text-xs">
      <p className="font-medium">as recorded by `hexagen evidence pack`</p>
      {ev.verdict !== null && <p>{safe(ev.verdict)}</p>}
      {ev.denials.length > 0 && (
        <ul className="space-y-1">
          {ev.denials.map((d) => (
            <li key={d.seq}>
              <span className="font-medium">denial</span> #{d.seq}{" "}
              {safe(d.haltReason ?? "denied")}
              {d.tool != null && <> / {safe(d.tool)}</>}
              {d.reason != null && <> / {safe(d.reason)}</>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground">
        Trace tail ({ev.tail.length} lines)
      </p>
      <ol className="space-y-0.5 font-mono">
        {ev.tail.map((l) => (
          <li key={l.seq} className="break-all">
            {l.denial && (
              <span className="mr-1 font-sans font-medium">[denial]</span>
            )}
            {l.seq}: {safe(l.text)}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StepRail({ steps }: { readonly steps: readonly StepView[] }) {
  return (
    <ol aria-label="Workbook steps" className="space-y-3">
      {steps.map((step) => (
        <li
          key={step.id}
          data-testid={`step-${step.id}`}
          className="rounded-lg border p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{step.label}</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs">
              {step.status}
            </span>
          </div>
          <ul className="mt-1 text-xs text-muted-foreground">
            {step.detail.map((d, i) => (
              <li key={i} className="break-all">
                {safe(d)}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center">
            <code className="mr-2 break-all font-mono text-xs">
              {step.command}
            </code>
            <CopyCommandButton stepLabel={step.label} command={step.command} />
          </div>
          <EvidenceDetail step={step} />
        </li>
      ))}
    </ol>
  );
}
