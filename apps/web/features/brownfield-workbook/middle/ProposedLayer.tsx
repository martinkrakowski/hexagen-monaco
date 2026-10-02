import { cleanText } from "@hexagen/shared";
import type { Contract, ObservedReport, Slice } from "@hexagen/shared";
import { sliceView } from "./derive";

/**
 * The proposed layer: the slice boundary and the contract rules, with the
 * observed edges that start inside the slice judged against the contract. The
 * judgement is `edgeViolatesRule` from `@hexagen/shared`.
 */

export interface ProposedLayerProps {
  readonly observed: ObservedReport | null;
  readonly slice: Slice | null;
  readonly contract: Contract | null;
  readonly visible: boolean;
  readonly onToggle: () => void;
}

const clean = cleanText;

function Badge({ children }: { children: string }) {
  return (
    <span
      data-badge
      className="rounded border px-1 text-xs uppercase tracking-wide"
    >
      {children}
    </span>
  );
}

function Violation({
  ruleId,
  severity,
}: {
  ruleId: string;
  severity?: string;
}) {
  return (
    <span data-testid="violation">
      <span
        data-badge
        className="rounded border border-destructive bg-destructive/10 px-1 text-xs uppercase tracking-wide"
      >
        violation
      </span>{" "}
      <span className="font-mono">{clean(ruleId)}</span>
      {severity !== undefined && <> ({clean(severity)})</>}
    </span>
  );
}

export function ProposedLayer({
  observed,
  slice,
  contract,
  visible,
  onToggle,
}: ProposedLayerProps) {
  const missing = slice === null && contract === null;
  const view = observed && slice ? sliceView(observed, slice, contract) : null;
  return (
    <section
      aria-label="Proposed"
      data-testid="proposed-layer"
      className="rounded border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Proposed</h2>
        {!missing && (
          <button
            type="button"
            aria-pressed={!visible}
            onClick={onToggle}
            className="rounded border px-2 text-xs"
          >
            {visible ? "Hide proposed" : "Show proposed"}
          </button>
        )}
      </div>
      {missing ? (
        <p className="mt-2 text-sm text-muted-foreground">
          The proposed layer is missing from this bundle: there is no slice and
          no contract. The observed layer is shown alone.
        </p>
      ) : (
        visible && (
          <div data-testid="proposed-layer-body" className="mt-2 space-y-4">
            <div>
              <h3 className="font-medium">Slice</h3>
              {slice === null ? (
                <p className="text-sm text-muted-foreground">
                  The slice is missing from this bundle.
                </p>
              ) : (
                <div className="mt-1 text-sm">
                  <ul className="space-y-1">
                    {slice.paths.map((p, i) => (
                      <li key={i} className="break-all font-mono">
                        {clean(p)}
                      </li>
                    ))}
                  </ul>
                  {slice.excludes.length > 0 && (
                    <>
                      <h4 className="mt-2 font-medium">Excludes</h4>
                      <ul className="space-y-1">
                        {slice.excludes.map((p, i) => (
                          <li key={i} className="break-all font-mono">
                            {clean(p)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-medium">Contract</h3>
              {contract === null ? (
                <p className="text-sm text-muted-foreground">
                  The contract is missing from this bundle.
                </p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {contract.rules.map((r, i) => (
                    <li
                      key={i}
                      data-testid="contract-rule"
                      className="break-all"
                    >
                      <span className="font-mono">{clean(r.id)}</span>{" "}
                      <Badge>{clean(r.kind)}</Badge>{" "}
                      <span className="font-mono">{clean(r.from)}</span>
                      {" -> "}
                      <span className="font-mono">{clean(r.to)}</span> (
                      {clean(r.severity)})
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {view !== null && (
              <div>
                <h3 className="font-medium">Edges</h3>
                <p className="text-xs text-muted-foreground">
                  Edges that start inside the slice.
                </p>
                <ul className="mt-1 space-y-1 text-sm">
                  {view.edges.map((v, i) => {
                    const bad = v.broken.length > 0;
                    return (
                      <li
                        key={i}
                        data-testid="slice-edge"
                        data-violation={bad ? "true" : "false"}
                        className={
                          bad
                            ? "break-all rounded border border-destructive bg-destructive/10 p-1"
                            : "break-all p-1"
                        }
                      >
                        {clean(v.edge.from)} {"->"} {clean(v.edge.to)} (
                        {clean(v.edge.specifier)}){" "}
                        {v.broken.map((r, j) => (
                          <Violation
                            key={j}
                            ruleId={r.id}
                            severity={r.severity}
                          />
                        ))}
                      </li>
                    );
                  })}
                  {view.unresolved.map((u, i) => (
                    <li
                      key={`u${i}`}
                      data-testid="slice-unresolved"
                      data-violation="true"
                      className="break-all rounded border border-destructive bg-destructive/10 p-1"
                    >
                      {clean(u.item.from)} {"->"} {clean(u.item.specifier)}{" "}
                      <Badge>unresolved</Badge>{" "}
                      <Violation ruleId={u.ruleId} severity="error" />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      )}
    </section>
  );
}
