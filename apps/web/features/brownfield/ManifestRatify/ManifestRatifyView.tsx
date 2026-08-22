"use client";

import { useId } from "react";
import { ArrowLeft, ArrowRight, Blocks, Box, Network, PackageX } from "lucide-react";
import { Button, Checkbox, Input, Label } from "@hexagen/ui";
import { CountPills } from "@/primitives/CountPills";
import { EmptyState } from "@/primitives/EmptyState";
import { EntityDataGrid } from "@/primitives/EntityDataGrid";
import type { EntityDataGridColumn } from "@/primitives/EntityDataGrid";
import { ChoiceCardGroup } from "@/primitives/ChoiceCardGroup";
import type { ChoiceCardOption } from "@/primitives/ChoiceCardGroup";
import type {
  BrownfieldManifestContextDraft,
  BrownfieldManifestDraft,
} from "../BrownfieldFlow/types";
import {
  MANIFEST_CONTEXT_TYPES,
  dependencyOptionsFor,
  includedContexts,
  type ManifestArchitecture,
  type ManifestContextType,
  type ManifestDraftProblem,
} from "./manifest-draft";
import type { ScopePreview } from "./scope-preview";

/**
 * S4 — "Ratify the manifest" (F-18).
 *
 * PRESENTATIONAL ONLY, on the split `BrownfieldImportPage` established: it owns
 * no draft state, performs no navigation, calls nothing. `ManifestRatify` is the
 * boundary that holds the reducer and decides what a change means. That is what
 * lets every rule on this screen — the scope preview, the dangling-edge refusal,
 * the zero-contexts block — be tested without a router or a fetch stub.
 *
 * COMPOSED, NOT REBUILT: `EntityDataGrid` (BF-2.1) for the context rows and
 * their expandable `depends_on` panel, `ChoiceCardGroup` (BF-2.2) for the
 * architecture pick, `CountPills` for the footer tally, `EmptyState` for the
 * no-candidates case, and `@hexagen/ui`'s `Input`/`Label`/`Checkbox`/`Button`
 * for the fields. Nothing here re-implements a table, a radio group or a badge.
 *
 * WHY THE SCOPE PREVIEW IS NOT A SILENT REWRITE. `hexagen bootstrap` runs the
 * entered scope through `sanitizeScope` on its way into `manifest.yaml`. Doing
 * that quietly means the user ratifies `@Acme Corp!` and their repository gets
 * `acme-corp`, with no moment where the two were both on screen. The preview
 * shows the result AND names each rule that fired, before the Continue button is
 * ever pressed. The input itself is never rewritten under the cursor.
 *
 * WHY A NATIVE `<select>` FOR THE CONTEXT TYPE (DESIGN.md §5.2 step 4 requires
 * this to be written down). `@hexagen/ui` has no select or combobox — elements/
 * is Button, Card, Input, Badge, Label, Textarea, Icon, Checkbox, Spinner,
 * Skeleton, CopyButton; modules/ is Tabs, Accordion, Tooltip, ViewToggle,
 * FileDropZone. `ChoiceCardGroup` is the nearest primitive and is deliberately
 * NOT reused per row: five cards × one row per package is a page of radio cards
 * for a five-value enum. The native control carries its own keyboard contract
 * and its own mobile affordance; it is styled to match `Input` and nothing more.
 */

const ARCHITECTURE_OPTIONS: readonly ChoiceCardOption<ManifestArchitecture>[] = [
  {
    value: "modular-monolith",
    label: "Modular monolith",
    description:
      "One deployable, bounded contexts as packages inside it. What hexagen bootstrap proposes, and what a workspace with packages/* usually already is.",
    Icon: Blocks,
  },
  {
    value: "microservices",
    label: "Microservices",
    description:
      "Each bounded context deploys on its own. Pick this only if that is already true of the repository you scanned — it changes what the conformance gate considers a boundary violation.",
    Icon: Network,
  },
  {
    value: "monolith",
    label: "Monolith",
    description:
      "One deployable with no package-level separation. Contexts are still ratified; they describe intent rather than an existing physical split.",
    Icon: Box,
  },
];

/** Human labels for the `bounded_contexts[].type` enum. */
const CONTEXT_TYPE_LABELS: Record<ManifestContextType, string> = {
  core: "core — the domain you are in business for",
  supporting: "supporting — needed, but not a differentiator",
  generic: "generic — could be bought instead of built",
  "shared-kernel": "shared kernel — deliberately shared by several contexts",
  driver: "driver — an entry point into another context",
};

/** One grid row. The index is carried because it, not the name, is the identity. */
interface ContextRow {
  readonly index: number;
  readonly context: BrownfieldManifestContextDraft;
}

export interface ManifestRatifyViewProps {
  draft: BrownfieldManifestDraft;
  /** What `sanitizeScope` will do to `draft.scope`, computed by the boundary. */
  scopePreview: ScopePreview;
  /** Everything blocking ratification. Empty means Continue is live. */
  problems: readonly ManifestDraftProblem[];
  onChangeSystem: (next: string) => void;
  onChangeScope: (next: string) => void;
  onChangeArchitecture: (next: ManifestArchitecture) => void;
  onPatchContext: (
    index: number,
    patch: Partial<BrownfieldManifestContextDraft>,
  ) => void;
  onToggleDependency: (
    index: number,
    target: string,
    shouldDepend: boolean,
  ) => void;
  onBack: () => void;
  onContinue: () => void;
}

/** Problems attached to one field, for rendering under its control. */
function problemsFor(
  problems: readonly ManifestDraftProblem[],
  field: ManifestDraftProblem["field"],
): readonly ManifestDraftProblem[] {
  return problems.filter((problem) => problem.field === field);
}

/** Space-separated id list for `aria-describedby`, or `undefined` when empty. */
function describedBy(...ids: readonly (string | null)[]): string | undefined {
  const present = ids.filter((id): id is string => id !== null);
  return present.length > 0 ? present.join(" ") : undefined;
}

function FieldProblems({
  id,
  problems,
}: {
  id: string;
  problems: readonly ManifestDraftProblem[];
}) {
  if (problems.length === 0) return null;

  return (
    <ul id={id} className="space-y-1 text-sm text-destructive">
      {problems.map((problem) => (
        <li key={problem.id}>{problem.message}</li>
      ))}
    </ul>
  );
}

export function ManifestRatifyView({
  draft,
  scopePreview,
  problems,
  onChangeSystem,
  onChangeScope,
  onChangeArchitecture,
  onPatchContext,
  onToggleDependency,
  onBack,
  onContinue,
}: ManifestRatifyViewProps) {
  const fieldId = useId();
  const systemId = `${fieldId}-system`;
  const scopeId = `${fieldId}-scope`;
  const systemProblemsId = `${systemId}-problems`;
  const scopeProblemsId = `${scopeId}-problems`;
  const scopePreviewId = `${scopeId}-preview`;

  const systemProblems = problemsFor(problems, "system");
  const scopeProblems = problemsFor(problems, "scope");
  const architectureProblems = problemsFor(problems, "architecture");
  const contextProblems = problemsFor(problems, "contexts");

  const includedCount = includedContexts(draft).length;
  const excludedCount = draft.contexts.length - includedCount;
  const scopeIsBlank = draft.scope.trim().length === 0;

  const rows: readonly ContextRow[] = draft.contexts.map((context, index) => ({
    index,
    context,
  }));

  const columns: readonly EntityDataGridColumn<ContextRow>[] = [
    {
      id: "include",
      header: "Include",
      headerHidden: true,
      cell: (row) => (
        <Checkbox
          checked={row.context.include}
          aria-label={`Include ${row.context.name || `context ${row.index + 1}`} in the manifest`}
          onCheckedChange={(checked) =>
            onPatchContext(row.index, { include: checked })
          }
        />
      ),
    },
    {
      id: "name",
      header: "Context",
      cell: (row) => (
        <Input
          value={row.context.name}
          aria-label={`Name of context ${row.index + 1}`}
          onChange={(event) =>
            onPatchContext(row.index, { name: event.target.value })
          }
        />
      ),
    },
    {
      id: "type",
      header: "Type",
      cell: (row) => (
        <select
          value={row.context.type}
          aria-label={`Type of ${row.context.name || `context ${row.index + 1}`}`}
          onChange={(event) =>
            onPatchContext(row.index, { type: event.target.value })
          }
          // Mirrors `Input`'s geometry and focus ring so the row does not read
          // as two different form systems side by side (DESIGN.md §4.7/§4.8).
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {MANIFEST_CONTEXT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CONTEXT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      ),
    },
    {
      id: "description",
      header: "Description",
      cell: (row) => (
        <Input
          value={row.context.description}
          placeholder="What this context is responsible for"
          aria-label={`Description of ${row.context.name || `context ${row.index + 1}`}`}
          onChange={(event) =>
            onPatchContext(row.index, { description: event.target.value })
          }
        />
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="text-center animate-fade-in-up delay-100">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          Ratify the manifest
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
          These are the values that get written to{" "}
          <code className="font-mono text-sm">.architecture/manifest.yaml</code>.
          Nothing here was inferred from your code — change anything you disagree
          with before you continue.
        </p>
      </div>

      <div className="space-y-6 animate-fade-in-up delay-200">
        <div className="space-y-2">
          <Label htmlFor={systemId}>System name</Label>
          <Input
            id={systemId}
            value={draft.system}
            placeholder="Acme Platform"
            aria-invalid={systemProblems.length > 0 || undefined}
            aria-describedby={
              systemProblems.length > 0 ? systemProblemsId : undefined
            }
            onChange={(event) => onChangeSystem(event.target.value)}
          />
          <FieldProblems id={systemProblemsId} problems={systemProblems} />
        </div>

        <div className="space-y-2">
          <Label htmlFor={scopeId}>npm scope</Label>
          <Input
            id={scopeId}
            value={draft.scope}
            placeholder="acme"
            aria-invalid={scopeProblems.length > 0 || undefined}
            // A plain join, NOT cn(): `cn` is tailwind-merge, and running a list
            // of element ids through a class-conflict resolver is asking it to
            // drop one of them on a name collision.
            aria-describedby={describedBy(
              scopeProblems.length > 0 ? scopeProblemsId : null,
              scopeIsBlank ? null : scopePreviewId,
            )}
            onChange={(event) => onChangeScope(event.target.value)}
          />

          {scopeIsBlank ? null : (
            <div
              id={scopePreviewId}
              // Polite, not assertive: this updates on every keystroke, and an
              // assertive region would interrupt the user mid-word.
              aria-live="polite"
              className="space-y-2 rounded-md border border-border bg-muted/40 p-3"
            >
              <p className="text-sm">
                Written to the manifest as{" "}
                <code className="font-mono font-semibold">
                  {scopePreview.value}
                </code>
                , so your packages are{" "}
                <code className="font-mono">
                  @{scopePreview.value}/&lt;package&gt;
                </code>
                .
              </p>

              {scopePreview.isUnchanged ? (
                <p className="text-sm text-muted-foreground">
                  Exactly what you typed — npm accepts it as written.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    npm will not accept what you typed verbatim, so bootstrap
                    changes it:
                  </p>
                  <ul className="space-y-1 text-sm text-muted-foreground list-disc pl-4">
                    {scopePreview.appliedRules.map((rule) => (
                      <li key={rule.id}>{rule.explanation}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <FieldProblems id={scopeProblemsId} problems={scopeProblems} />
        </div>

        <div className="space-y-3">
          <ChoiceCardGroup<ManifestArchitecture>
            label="Architecture"
            description="What shape the repository is, not what you would like it to be. The conformance gate reads this."
            options={ARCHITECTURE_OPTIONS}
            value={
              ARCHITECTURE_OPTIONS.some(
                (option) => option.value === draft.architecture,
              )
                ? (draft.architecture as ManifestArchitecture)
                : null
            }
            onSelect={onChangeArchitecture}
          />
          <FieldProblems
            id={`${fieldId}-architecture-problems`}
            problems={architectureProblems}
          />
        </div>
      </div>

      <div className="space-y-3 animate-fade-in-up delay-300">
        <h2 className="text-lg font-medium">Bounded contexts</h2>

        {draft.contexts.length === 0 ? (
          <EmptyState
            icon={PackageX}
            title="No candidate contexts came out of the scan"
            description="Go back and re-ratify the layout — a manifest with no bounded contexts is not something bootstrap will write."
            headingLevel={3}
          />
        ) : (
          <EntityDataGrid<ContextRow>
            caption="Candidate bounded contexts, as ratified on the layout step"
            captionAppearance="screen-reader-only"
            rows={rows}
            columns={columns}
            rowKey={(row) => String(row.index)}
            rowHeaderColumnId="name"
            // Appearance intent chosen here, by the host — the grid is not being
            // told a verdict it then has to interpret.
            rowVariant={(row) => (row.context.include ? "default" : "muted")}
            expandLabel={(row) =>
              `Dependencies of ${row.context.name || `context ${row.index + 1}`}`
            }
            renderExpandedRow={(row) => {
              const options = dependencyOptionsFor(draft, row.index);

              if (options.length === 0) {
                return (
                  <p className="text-sm text-muted-foreground">
                    No other context is included yet, so there is nothing to
                    depend on. Edges are never inferred — you add each one here.
                  </p>
                );
              }

              return (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Tick a context this one is allowed to import from. Nothing is
                    ticked for you: bootstrap infers no edges.
                  </p>
                  <ul className="space-y-2">
                    {options.map((target) => {
                      const isDependent =
                        row.context.dependsOn.includes(target);
                      return (
                        <li key={target} className="flex items-center gap-2">
                          <Checkbox
                            checked={isDependent}
                            aria-label={`${row.context.name || `Context ${row.index + 1}`} depends on ${target}`}
                            onCheckedChange={(checked) =>
                              onToggleDependency(row.index, target, checked)
                            }
                          />
                          <span className="font-mono text-sm">{target}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            }}
          />
        )}

        {contextProblems.length > 0 ? (
          <FieldProblems
            id={`${fieldId}-context-problems`}
            problems={contextProblems}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4 animate-fade-in-up delay-300">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
          Back to the layout
        </Button>

        <div className="flex flex-wrap items-center gap-4">
          <CountPills
            label="Context tally"
            appearance="inline"
            pills={[
              {
                id: "included",
                label: "included",
                count: includedCount,
                tone: includedCount > 0 ? "positive" : "warning",
              },
              {
                id: "excluded",
                label: "excluded",
                count: excludedCount,
                tone: "neutral",
              },
            ]}
          />

          <Button
            onClick={onContinue}
            disabled={problems.length > 0}
            // The button going grey is not an explanation. Every problem is
            // already rendered next to the control that caused it, and this
            // names the count so a user who scrolled past them knows to look.
            aria-describedby={
              problems.length > 0 ? `${fieldId}-continue-hint` : undefined
            }
          >
            Continue
            <ArrowRight className="h-4 w-4 ml-2" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {problems.length > 0 ? (
        <p
          id={`${fieldId}-continue-hint`}
          className="text-sm text-destructive text-right"
        >
          {problems.length === 1
            ? "One thing still has to be settled before this manifest can be written."
            : `${problems.length} things still have to be settled before this manifest can be written.`}
        </p>
      ) : null}
    </div>
  );
}
