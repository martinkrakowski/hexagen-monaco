import { cleanText, edgesComplete, isPathInSlice } from "@hexagen/shared";
import type { ObservedReport, Slice } from "@hexagen/shared";
import { itemsOf, packageEdges } from "./derive";

/**
 * The observed layer: packages, cross-package edges and unresolved imports, in
 * the repo's own names. There is deliberately no prop or control that hides it.
 */

export interface ObservedLayerProps {
  readonly observed: ObservedReport | null;
  readonly slice: Slice | null;
  readonly expanded: ReadonlySet<number>;
  readonly onToggle: (group: number) => void;
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

function Note({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      aria-label={label}
      className="mt-2 rounded border border-destructive p-2 text-sm"
    >
      {children}
    </div>
  );
}

export function ObservedLayer({
  observed,
  slice,
  expanded,
  onToggle,
}: ObservedLayerProps) {
  return (
    <section
      aria-label="Observed"
      data-testid="observed-layer"
      className="rounded border p-3"
    >
      <h2 className="text-lg font-semibold">Observed</h2>
      {observed === null ? (
        <p className="mt-2 text-sm text-muted-foreground">
          The observed report is not in this bundle.
        </p>
      ) : (
        <ObservedBody
          observed={observed}
          slice={slice}
          expanded={expanded}
          onToggle={onToggle}
        />
      )}
    </section>
  );
}

function ObservedBody({
  observed,
  slice,
  expanded,
  onToggle,
}: Omit<ObservedLayerProps, "observed"> & { observed: ObservedReport }) {
  const pk = itemsOf(observed.packages);
  const ed = itemsOf(observed.edges);
  const un = itemsOf(observed.unresolved);
  const packages = pk.items ?? [];
  const groups = ed.items ? packageEdges(packages, ed.items) : [];
  const empty =
    packages.length === 0 &&
    (ed.items?.length ?? 0) === 0 &&
    (un.items?.length ?? 0) === 0;

  return (
    <div className="mt-2 space-y-4">
      {!edgesComplete(observed.edges) && (
        <Note label="Edges incomplete">
          Edges incomplete:{" "}
          {observed.edges.collected
            ? `the import pass did not read ${observed.edges.unreadLanguages.map(clean).join(", ")}.`
            : `${clean(observed.edges.reason)}.`}{" "}
          An empty or short edge list is not a clean result.
        </Note>
      )}
      {observed.limits.truncated && (
        <Note label="Scan truncated">
          Scan truncated
          {observed.limits.reasons.length > 0
            ? `: ${observed.limits.reasons.map(clean).join("; ")}`
            : ""}
          . What follows is part of the repo.
        </Note>
      )}
      {empty && observed.edges.collected && (
        <p className="text-sm text-muted-foreground">
          The observed report is empty.
        </p>
      )}

      <div>
        <h3 className="font-medium">Packages</h3>
        {pk.items === null ? (
          <p className="text-sm text-muted-foreground">
            Packages were not collected: {clean(pk.reason)}
          </p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {pk.items.map((p, i) => (
              <li key={i} className="break-all">
                <span className="font-mono">{clean(p.name)}</span>{" "}
                <span className="text-muted-foreground">{clean(p.root)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="font-medium">Edges</h3>
        {ed.items === null ? (
          <p className="text-sm text-muted-foreground">
            Edges were not collected: {clean(ed.reason)}
          </p>
        ) : (
          <ul className="mt-1 space-y-2 text-sm">
            {groups.map((g, i) => {
              const open = expanded.has(i);
              return (
                <li key={i} data-testid="package-edge" className="break-all">
                  <span className="font-mono">{clean(g.from)}</span>
                  {" -> "}
                  <span className="font-mono">{clean(g.to)}</span>{" "}
                  <span>
                    {g.edges.length} {g.edges.length === 1 ? "edge" : "edges"}
                  </span>{" "}
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => onToggle(i)}
                    className="rounded border px-2 text-xs"
                  >
                    {open ? "Collapse" : "Expand"}
                    <span className="sr-only"> files</span>
                  </button>
                  {open && (
                    <ul className="mt-1 space-y-1 pl-4">
                      {g.edges.map((e, j) => {
                        const inSlice =
                          slice !== null && isPathInSlice(slice, e.from);
                        return (
                          <li
                            key={j}
                            data-testid="file-edge"
                            data-in-slice={inSlice ? "true" : "false"}
                          >
                            {clean(e.from)} {"->"} {clean(e.to)} (
                            {clean(e.specifier)}){" "}
                            {inSlice && <Badge>in slice</Badge>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 className="font-medium">Unresolved</h3>
        {un.items === null ? (
          <p className="text-sm text-muted-foreground">
            Unresolved imports were not collected: {clean(un.reason)}
          </p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {un.items.map((u, i) => (
              <li key={i} data-testid="unresolved-mark" className="break-all">
                <Badge>unresolved</Badge> {clean(u.specifier)} in{" "}
                {clean(u.from)} ({clean(u.reason)})
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
