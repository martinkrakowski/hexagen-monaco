import { cleanText } from "@hexagen/shared";
import { BundleIntake } from "./BundleIntake";
import { MiddlePanel } from "./middle/MiddlePanel";
import { StepRail } from "./StepRail";
import { deriveSteps } from "./steps";
import type { LoadedBundle } from "./bundle/read-bundle";

/**
 * The brownfield workbook viewer (BW7b). It is a SEPARATE surface from
 * `ProjectWorkspace` (BW-D7): it must never mount `GovernancePanelWrapper`,
 * `useEditorPush`, the generate flow (`useProjectGenerationFlow`,
 * `/api/generate`) or any control that calls `/api/architecture/modify/accept`,
 * `/api/push/github` or `/api/export/github`. Those write the server's monorepo
 * or a user's own GitHub repo, never a client checkout.
 * `app/projects/brownfield/BrownfieldViewerClient.test.tsx` pins that with
 * throwing mocks.
 *
 * BW-D2: the bundle is read in the browser and never uploaded or stored. This
 * component is presentational: it renders only text, with no HTML sink, and
 * makes no network call. The step statuses come from the bundle alone.
 */

/** Permanent: the browser cannot check the HMAC, because the key never leaves the laptop. */
export const INTEGRITY_NOTICE =
  "integrity: entries match the bundle index; the bundle's signature can only be checked with `hexagen` on the engagement machine.";

export type IntakeState =
  | { readonly phase: "idle" }
  | { readonly phase: "reading"; readonly fileName: string }
  | {
      readonly phase: "refused";
      readonly fileName: string;
      readonly errors: readonly string[];
    }
  | {
      readonly phase: "ready";
      readonly fileName: string;
      readonly bundle: LoadedBundle;
    };

export interface BrownfieldViewerPageProps {
  /** Workbook name, or null while loading / when the project is not found. */
  readonly name: string | null;
  readonly status: "loading" | "ready" | "missing";
  readonly intake: IntakeState;
  readonly onFile: (file: File) => void;
}

export function BrownfieldViewerPage({
  name,
  status,
  intake,
  onFile,
}: BrownfieldViewerPageProps) {
  if (status === "loading") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-muted-foreground">
        Loading workbook...
      </main>
    );
  }
  if (status === "missing" || name === null) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-2xl font-bold tracking-tight">
          Workbook not found
        </h1>
        <p className="mt-2 text-muted-foreground">
          This is not a saved brownfield workbook.
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">{name}</h1>
      <div className="mt-6">
        <BundleIntake onFile={onFile} />
        {intake.phase === "reading" && (
          <p className="mt-3 text-sm text-muted-foreground">
            Reading {cleanText(intake.fileName)}...
          </p>
        )}
        {intake.phase === "refused" && (
          <div
            role="alert"
            className="mt-3 rounded border border-destructive p-3 text-sm"
          >
            <p className="font-medium">
              {cleanText(intake.fileName)} was refused:
            </p>
            <ul className="mt-1 list-disc pl-4">
              {intake.errors.map((e, i) => (
                <li key={i} className="break-all">
                  {cleanText(e)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {intake.phase === "ready" && (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            {cleanText(intake.fileName)} is open in this tab only.
          </p>
          <p role="note" className="mt-1 text-sm font-medium">
            {INTEGRITY_NOTICE}
          </p>
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <aside aria-label="Left rail">
              <StepRail steps={deriveSteps(intake.bundle)} />
            </aside>
            <section aria-label="Middle panel" data-testid="slot-middle-panel">
              <MiddlePanel bundle={intake.bundle} />
            </section>
            {/* BW9 fills this slot: the agent under the grant. Leave it empty here. */}
            <section aria-label="Right panel" data-testid="slot-right-panel" />
          </div>
        </>
      )}
    </main>
  );
}
