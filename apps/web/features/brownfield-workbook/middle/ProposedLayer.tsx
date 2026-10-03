import { useMemo } from "react";
import { cleanText } from "@hexagen/shared";
import type { Contract, ObservedReport, Slice } from "@hexagen/shared";
import {
  contractApplies,
  incompleteReasons,
  mismatchNotices,
  sliceView,
  type KnownMark,
} from "./derive";

/**
 * The proposed layer: the slice boundary and the contract rules, with the
 * observed edges that start inside the slice judged against the contract. The
 * judgement is `edgeViolatesRule` from `@hexagen/shared`.
 */

export interface ProposedLayerProps {
  readonly observed: ObservedReport | null;
  readonly slice: Slice | null;
  readonly contract: Contract | null;
  /** The bundle's date (ISO): baseline expiries are judged against it, never the wall clock. */
  readonly createdAt: string;
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
  known,
}: {
  ruleId: string;
  severity: string;
  known: KnownMark | null;
}) {
  const warn = severity === "warn";
  return (
    <span data-testid="violation" data-severity={severity}>
      <span
        data-badge
        className={
          warn
            ? "rounded border px-1 text-xs uppercase tracking-wide"
            : "rounded border border-destructive bg-destructive/10 px-1 text-xs uppercase tracking-wide"
        }
      >
        {warn ? "warning" : "violation"}
      </span>{" "}
      <span className="font-mono">{clean(ruleId)}</span> ({clean(severity)})
      {known !== null && (
        <>
          {" "}
          <span
            data-badge
            data-testid="known-mark"
            className="rounded border px-1 text-xs uppercase tracking-wide"
          >
            known
          </span>
          {known.expires !== undefined && <> expires {clean(known.expires)}</>}
        </>
      )}
    </span>
  );
}

export function ProposedLayer({
  observed,
  slice,
  contract,
  createdAt,
  visible,
  onToggle,
}: ProposedLayerProps) {
  const missing = slice === null && contract === null;
  // Judged only while the body shows, and only against a contract for this slice.
  const applies = slice !== null && contractApplies(slice, contract);
  const view = useMemo(
    () =>
      visible && observed && slice
        ? sliceView(
            observed,
            slice,
            applies ? contract : null,
            new Date(createdAt),
          )
        : null,
    [visible, observed, slice, contract, applies, createdAt],
  );
  const reasons = observed ? incompleteReasons(observed) : [];
  const notices = mismatchNotices(observed, slice, contract);
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
            {notices.map((n, i) => (
              <p key={i} role="note" className="rounded border p-2 text-sm">
                {clean(n)}
              </p>
            ))}
            {slice !== null && contract !== null && !applies && (
              <p role="note" className="text-sm">
                No contract rule was applied: the contract belongs to another
                slice.
              </p>
            )}
            {slice !== null && observed === null && (
              <p role="note" className="text-sm text-muted-foreground">
                No observed report, so no edge was judged.
              </p>
            )}
            {slice !== null && reasons.length > 0 && (
              <div
                role="alert"
                aria-label="Contract check incomplete"
                className="rounded border border-destructive p-2 text-sm"
              >
                {reasons.map((r, i) => (
                  <p key={i}>{clean(r)}</p>
                ))}
              </div>
            )}
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
                      {/* `closed` carries no from/to: its excepts are the rule. */}
                      {r.kind === "closed" ? (
                        r.except.length > 0 && (
                          <span className="font-mono">
                            {r.except.map(clean).join(", ")}
                          </span>
                        )
                      ) : (
                        <>
                          <span className="font-mono">{clean(r.from)}</span>
                          {" -> "}
                          <span className="font-mono">{clean(r.to)}</span>
                        </>
                      )}{" "}
                      ({clean(r.severity)})
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
                            ruleId={r.rule.id}
                            severity={r.rule.severity}
                            known={r.known}
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
                      <Violation
                        ruleId={u.ruleId}
                        severity="error"
                        known={u.known}
                      />
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
