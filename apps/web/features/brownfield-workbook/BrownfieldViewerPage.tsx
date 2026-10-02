/**
 * Placeholder for the brownfield workbook viewer (BW6). BW7b builds the real
 * browser-side bundle viewer on this page.
 *
 * BW-D7: this page is deliberately a SEPARATE surface from `ProjectWorkspace`.
 * It must never mount `GovernancePanelWrapper`, `useEditorPush`, the generate
 * flow (`useProjectGenerationFlow`, `/api/generate`) or any control that calls
 * `/api/architecture/modify/accept`, `/api/push/github` or
 * `/api/export/github`: those write the
 * server's monorepo or a user's own GitHub repo, never a client checkout.
 * `app/projects/brownfield/BrownfieldViewerClient.test.tsx` pins that with throwing mocks. Keep this
 * component presentational: text only, no hooks, no fetches.
 */

export interface BrownfieldViewerPageProps {
  /** Workbook name, or null while loading / when the project is not found. */
  readonly name: string | null;
  readonly status: "loading" | "ready" | "missing";
}

/** The CLI steps, as plain text. The page never runs a command. */
export const BROWNFIELD_CLI_STEPS: readonly {
  readonly step: string;
  readonly command: string;
}[] = [
  { step: "Checkout", command: "git clone <client-repo>" },
  { step: "Observe", command: "hexagen observe --out .hexagen/observed.json" },
  { step: "Slice", command: "hexagen slice init --path <path>" },
  { step: "Contract", command: "hexagen contract check" },
  { step: "Grant", command: "hexagen grant issue" },
  { step: "Evidence", command: "hexagen evidence pack" },
];

export function BrownfieldViewerPage({
  name,
  status,
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
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">{name}</h1>
      <p className="mt-4 text-muted-foreground">
        The bundle viewer arrives in a later release. Until then, work on your
        own clone with the CLI. The steps are:
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-6">
        {BROWNFIELD_CLI_STEPS.map(({ step, command }) => (
          <li key={step}>
            <span className="font-medium">{step}</span>:{" "}
            <code className="font-mono text-sm">{command}</code>
          </li>
        ))}
      </ol>
    </main>
  );
}
