"use client";

import {
  CheckCircle2,
  Download,
  FileArchive,
  GitPullRequest,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import {
  Button,
  CopyButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@hexagen/ui";
import { ChoiceCardGroup } from "@/primitives/ChoiceCardGroup";
import type { ChoiceCardOption } from "@/primitives/ChoiceCardGroup";
import { EmptyState } from "@/primitives/EmptyState";
import type { BrownfieldGateInstallMode } from "../BrownfieldFlow/types";
import type { GateInstallPhase } from "./useGateInstall";
import {
  GATE_BUNDLE_ENTRIES,
  GATE_PACKAGE_JSON_PATCH,
  type GateBundleEntry,
} from "./gate-bundle-manifest";

/**
 * S7 — "Install the conformance gate".
 *
 * This is the last screen of the brownfield flow and the only one that produces
 * something the user keeps. Everything before it is a rendered opinion; this is
 * the artifact. The primary action is therefore a single, named, unmissable
 * button ("Download the gate bundle"), and the secondary is worded as a
 * deferral ("Not now") rather than a cancellation, because leaving here
 * empty-handed is the failure mode this screen exists to prevent.
 *
 * PRESENTATIONAL. It holds no state, issues no request and knows nothing about
 * the state machine: `phase` comes in, intents go out. `useGateInstall` owns
 * the request and `GateInstall.tsx` wires the two. That split is what lets the
 * `delivered` and `failed` panels be asserted without a network stub.
 *
 * A dialog rather than a page, per the plan's flow diagram — S6 (the report)
 * stays mounted behind it, so the user never loses the findings they are about
 * to gate against.
 */

/**
 * The delivery modes, straight off `BrownfieldGateInstallMode`. Module-level so
 * the array identity is stable across renders and so the copy is reviewable in
 * one place rather than scattered through JSX.
 *
 * `open-pr` ships DISABLED, and that is not a placeholder: the route answers it
 * with a 501, and opening a branch in someone else's repository is BF-6.3, a
 * security packet gated on decision D-U3. `unavailableReason` says why in the
 * consultant's own terms — the objection is the all-repos OAuth scope, not an
 * unfinished button.
 */
const GATE_INSTALL_MODES: readonly ChoiceCardOption<BrownfieldGateInstallMode>[] =
  [
    {
      value: "download-zip",
      label: "Download a zip",
      description:
        "You get the gate as files and open the pull request inside your client's own review process. Nothing is written to any repository.",
      badge: "works anonymously",
      Icon: FileArchive,
    },
    {
      value: "open-pr",
      label: "Open a pull request for me",
      description:
        "Pushes a branch to the repository and opens the pull request from your GitHub connection.",
      disabled: true,
      unavailableReason:
        "Not available yet. Connecting GitHub grants access to every repository you can reach, which is the wrong trade for a client engagement — so this stays off until the permission can be scoped to one repo.",
      Icon: GitPullRequest,
    },
  ];

export interface GateInstallDialogProps {
  open: boolean;
  /** Which delivery mode is picked. Controlled by the container. */
  mode: BrownfieldGateInstallMode;
  onSelectMode: (next: BrownfieldGateInstallMode) => void;
  phase: GateInstallPhase;
  /** Finished copy for the `failed` panel. */
  message?: string | null;
  /** Name of the saved file, for the `delivered` panel. */
  fileName?: string | null;
  /** Ask for the bundle. Also the retry affordance on `failed`. */
  onInstall: () => void;
  onClose: () => void;
  /**
   * Injectable so a caller (or a test) can render a bundle listing that is not
   * the compiled-in mirror. Defaults to `GATE_BUNDLE_ENTRIES`, which the drift
   * test pins to `hexagenGateBundleFiles()`.
   */
  entries?: readonly GateBundleEntry[];
}

/**
 * The `package.json` block, with its D-B4 explanation.
 *
 * Rendered in BOTH the pre-download body and the post-download panel on
 * purpose. It is the one step the bundle cannot perform, so it has to be in
 * front of the user at the moment they act on it — and after the download is
 * exactly that moment.
 */
function PackageJsonPatch() {
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">
            One step the bundle will not do for you
          </h3>
          {/*
            D-B4, in the user's words. The zip never edits a `package.json` it
            does not own — that is the only irreversible change it could make to
            a client's repository, and we know neither their package manager nor
            whether the file is generated. Any copy here that implies the
            download patches anything is wrong.
          */}
          <p className="mt-1 text-xs text-muted-foreground">
            The bundle does not touch your <code>package.json</code>. Merge
            these three keys into it by hand — the same instructions ship inside
            the zip as <code>HEXAGEN-GATE-INSTALL.md</code>.
          </p>
        </div>
        <CopyButton
          text={GATE_PACKAGE_JSON_PATCH}
          label="Copy"
          variant="outline"
        />
      </div>
      {/*
        `tabIndex={0}` because the block scrolls horizontally on a narrow
        viewport, and a scrollable region that cannot be focused cannot be
        scrolled from the keyboard at all.
      */}
      <pre
        tabIndex={0}
        className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
      >
        <code>{GATE_PACKAGE_JSON_PATCH}</code>
      </pre>
      {/*
        The plan's required ⚠ line. The bundle materialises the workflow and the
        vendored action and nothing else, so a repository without the yarn pin
        and these two scripts installs cleanly and then fails on its first CI
        run — which is exactly the impression the gate must not make.
      */}
      <p className="mt-3 flex items-start gap-2 text-xs text-warning">
        <TriangleAlert className="mt-1 h-4 w-4 shrink-0" />
        <span>
          Without the pin and both scripts the workflow fails on its first run.
          Nothing in the bundle adds them for you.
        </span>
      </p>
    </section>
  );
}

export function GateInstallDialog({
  open,
  mode,
  onSelectMode,
  phase,
  message = null,
  fileName = null,
  onInstall,
  onClose,
  entries = GATE_BUNDLE_ENTRIES,
}: GateInstallDialogProps) {
  const preparing = phase === "preparing";
  const delivered = phase === "delivered";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      // Escape and backdrop clicks are disabled only while the request is in
      // flight, so a stray click cannot orphan a build the user is waiting on.
      dismissible={!preparing}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Install the conformance gate</DialogTitle>
          <DialogDescription>
            {delivered
              ? "The gate is on your machine. Two steps left before it runs."
              : "Take the gate with you. It fails a pull request that adds a new architectural violation, and stays quiet on one that does not."}
          </DialogDescription>
        </DialogHeader>

        {/*
          A PERSISTENT polite live region, mounted in every phase and empty in
          most of them. It has to outlive the phase change to be announced at
          all — a live region inserted together with its own text is unreliably
          read, and this flow changes phase without moving focus, so it is the
          only signal a screen-reader user gets that the download happened.
        */}
        <p role="status" className="sr-only">
          {preparing ? "Building the gate bundle." : null}
          {delivered ? `Saved ${fileName ?? "the gate bundle"}.` : null}
        </p>

        {/*
          `max-h-*` + scroll rather than a taller dialog: the footer must stay
          on screen, because the footer is where the artifact is.
        */}
        <div className="max-h-96 space-y-4 overflow-y-auto">
          {delivered ? (
            <>
              <div className="flex items-start gap-3 rounded-lg border border-border p-4">
                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-success" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    Saved{" "}
                    {fileName ? <code>{fileName}</code> : "the gate bundle"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Unzip it at the root of the repository you are gating. It
                    writes only under <code>.github/</code>, plus the install
                    notes.
                  </p>
                </div>
              </div>

              <PackageJsonPatch />

              <section className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-medium">
                  Then, before the pull request
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run the gate locally first — a gate whose first failure is in
                  CI is a gate the team turns off. On an existing codebase, seed
                  a baseline so day one is green and the ratchet shrinks it from
                  there.
                </p>
                <pre
                  tabIndex={0}
                  className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
                >
                  <code>
                    {[
                      "corepack enable",
                      "yarn install",
                      "yarn hexagen-lint --update-baseline",
                      "yarn hexagen-lint --ratchet",
                      "yarn sync:check",
                    ].join("\n")}
                  </code>
                </pre>
              </section>
            </>
          ) : (
            <>
              <ChoiceCardGroup<BrownfieldGateInstallMode>
                label="How to take the gate away"
                options={GATE_INSTALL_MODES}
                value={mode}
                onSelect={onSelectMode}
              />

              <section className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-medium">
                  {entries.length} {entries.length === 1 ? "file" : "files"},
                  added to your repository
                </h3>
                <ul className="mt-3 space-y-2">
                  {entries.map((entry) => (
                    <li key={entry.path} className="min-w-0">
                      <code className="block break-all text-xs">
                        {entry.path}
                      </code>
                      <span className="block text-xs text-muted-foreground">
                        {entry.purpose}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  No application code is changed, and no existing file is
                  rewritten.
                </p>
              </section>

              <PackageJsonPatch />

              {phase === "failed" ? (
                // The primitive's own contract: a boundary decides what a
                // failure means and hands finished copy in as title/description.
                // `EmptyState` deliberately has no `error` prop.
                <div role="alert">
                  <EmptyState
                    icon={OctagonAlert}
                    title="The gate bundle could not be prepared"
                    description={message ?? undefined}
                    headingLevel={3}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter>
          {delivered ? (
            <>
              <Button variant="outline" onClick={onInstall}>
                Download again
              </Button>
              {/*
                An explicit end. The flow does NOT route anywhere on its own
                from a success arm — the user closes this when they are ready.
              */}
              <Button onClick={onClose}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={preparing}>
                Not now
              </Button>
              <Button onClick={onInstall} disabled={preparing}>
                {preparing ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    Building the bundle
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    {phase === "failed"
                      ? "Try again"
                      : "Download the gate bundle"}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
