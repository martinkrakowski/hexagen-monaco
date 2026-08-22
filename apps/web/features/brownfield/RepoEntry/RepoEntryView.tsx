"use client";

import type { FormEvent } from "react";
import { useId } from "react";
import { Github, ShieldAlert } from "lucide-react";
import { Badge, Input, Label } from "@hexagen/ui";
import { MAX_PROJECT_NAME_CHARS } from "@/lib/project-scan/limits";

/**
 * S2a — Tier-B repository entry (F-16, BF-5.3). PRESENTATIONAL ONLY.
 *
 * No fetch, no router, no state machine, and no verdict of its own: the
 * advisory sentence and the reason the submit button is inert are computed by
 * `repo-input.ts` and handed in as finished copy. Same boundary/view split as
 * `TierPickerView` (S1) and `FindingsReviewView` (S5), and it is what lets this
 * screen be exercised without a router mock or the free-tier context.
 *
 * ## The submit button is not in this file
 *
 * The plan's chrome rule puts Back and the primary action in
 * `ProjectsShellWithFreeTier`'s `footer` slot, never in the content column. A
 * form whose only submit control lives outside its `<form>` cannot be
 * submitted with Enter, which on a three-field form is the way most people
 * will try. So the form takes an `id` and the footer's button carries
 * `form={id}` — HTML's own form-owner association, no hidden duplicate button
 * and no key handler.
 *
 * ## What the privacy strip is for
 *
 * Tier B is the one tier where source code leaves the user's machine. The plan
 * makes that an honesty affordance rather than fine print, so the "what leaves
 * your machine" statement and the public-repositories-only constraint are
 * stated on the screen where the decision is made, next to the field, in the
 * same visual language as S1's tier cards.
 */

export interface RepoEntryViewProps {
  /** `id` of the `<form>`, so a footer button can own it via `form={...}`. */
  readonly formId: string;
  /** Raw text of the repository box, exactly as typed. */
  readonly repoInput: string;
  /** Raw text of the branch/tag box. Blank means the default branch. */
  readonly refInput: string;
  readonly projectName: string;
  /**
   * Finished advisory copy for the repository box, or `null` when there is
   * nothing to say. Never computed here.
   */
  readonly advisory: string | null;
  /** Disables every field while a run is starting. */
  readonly frozen: boolean;
  readonly onRepoInputChange: (value: string) => void;
  readonly onRefInputChange: (value: string) => void;
  readonly onProjectNameChange: (value: string) => void;
  /** Raised on Enter and by the footer's submit button alike. */
  readonly onSubmit: () => void;
}

export function RepoEntryView({
  formId,
  repoInput,
  refInput,
  projectName,
  advisory,
  frozen,
  onRepoInputChange,
  onRefInputChange,
  onProjectNameChange,
  onSubmit,
}: RepoEntryViewProps) {
  const repoFieldId = useId();
  const repoHelpId = useId();
  const advisoryId = useId();
  const refFieldId = useId();
  const refHelpId = useId();
  const nameFieldId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Github className="h-5 w-5 shrink-0" aria-hidden="true" />
          Scan a public GitHub repository
        </h2>
        <p className="text-sm text-muted-foreground">
          We shallow-clone the repository on the server, run{" "}
          <code className="font-mono text-xs">hexagen scan</code> over it, and
          delete the clone. Nothing is retained but the scan artifacts, which
          you ratify on the next screens.
        </p>
      </header>

      {/*
        Deliberately not `role="alert"`: this is a standing property of the
        tier, present from first paint. An alert would announce it as though
        something had just gone wrong.
      */}
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm flex gap-2 items-start">
        <ShieldAlert
          className="h-4 w-4 mt-1 shrink-0 text-warning"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="font-medium">Not for client engagements.</p>
          <p className="text-muted-foreground">
            The repository is fetched by our server, so it must be public. For
            code that cannot leave your machine, run{" "}
            <code className="font-mono text-xs">
              npx hexagen scan --handoff
            </code>{" "}
            locally and upload the handoff zip instead.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline">clone</Badge>
            <Badge variant="outline">scan</Badge>
            <Badge variant="outline">delete</Badge>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={repoFieldId}>Repository</Label>
        <Input
          id={repoFieldId}
          name="repository"
          value={repoInput}
          disabled={frozen}
          autoComplete="off"
          spellCheck={false}
          placeholder="owner/repo"
          aria-describedby={
            advisory === null ? repoHelpId : `${repoHelpId} ${advisoryId}`
          }
          aria-invalid={advisory === null ? undefined : true}
          onChange={(event) => onRepoInputChange(event.target.value)}
        />
        <p id={repoHelpId} className="text-xs text-muted-foreground">
          <code className="font-mono">owner/repo</code>, or a full github.com
          URL.
        </p>
        {advisory === null ? null : (
          <p id={advisoryId} className="text-xs text-destructive">
            {advisory}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={refFieldId}>Branch or tag</Label>
        <Input
          id={refFieldId}
          name="ref"
          value={refInput}
          disabled={frozen}
          autoComplete="off"
          spellCheck={false}
          placeholder="default branch"
          aria-describedby={refHelpId}
          onChange={(event) => onRefInputChange(event.target.value)}
        />
        <p id={refHelpId} className="text-xs text-muted-foreground">
          Optional. Left blank, the repository&apos;s own default branch is used
          — we ask GitHub for it rather than assuming a name.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={nameFieldId}>Project name</Label>
        <Input
          id={nameFieldId}
          name="projectName"
          value={projectName}
          disabled={frozen}
          maxLength={MAX_PROJECT_NAME_CHARS}
          onChange={(event) => onProjectNameChange(event.target.value)}
        />
      </div>
    </form>
  );
}
