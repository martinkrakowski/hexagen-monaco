"use client";

import { useMemo, useState } from "react";
import type { LoadedBundle } from "../bundle/read-bundle";
import { CodePanel } from "./CodePanel";
import { codeFiles } from "./derive";
import { ObservedLayer } from "./ObservedLayer";
import { ProposedLayer } from "./ProposedLayer";

/**
 * The viewer's middle panel (BW8): the observed layer and the proposed layer
 * side by side, then the code panel. Container: it holds the local view state
 * (which edge groups are expanded, whether the proposed layer is shown, which
 * file the code panel shows) and nothing else. The bundle is read-only here.
 * There is no state that hides the observed layer.
 */
export function MiddlePanel({ bundle }: { readonly bundle: LoadedBundle }) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [proposedVisible, setProposedVisible] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const files = useMemo(
    () => codeFiles(bundle.texts, bundle.grants),
    [bundle.texts, bundle.grants],
  );

  const toggle = (group: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(group)) next.add(group);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 2xl:grid-cols-2">
        <ObservedLayer
          observed={bundle.observed}
          slice={bundle.slice}
          expanded={expanded}
          onToggle={toggle}
        />
        <ProposedLayer
          observed={bundle.observed}
          slice={bundle.slice}
          contract={bundle.contract}
          createdAt={bundle.index.createdAt}
          visible={proposedVisible}
          onToggle={() => setProposedVisible((v) => !v)}
        />
      </div>
      <CodePanel files={files} selected={selected} onSelect={setSelected} />
    </div>
  );
}
