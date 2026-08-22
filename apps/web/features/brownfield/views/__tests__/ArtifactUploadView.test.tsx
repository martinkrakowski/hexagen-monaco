import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProjectHandoffResponse } from "@/lib/project-scan/artifact-parse";
import { ArtifactUploadView } from "../ArtifactUploadView";
import type { ArtifactUploadViewProps } from "../ArtifactUploadView";

// jest-dom is NOT registered by apps/web/vitest.setup.ts — toBeTruthy(),
// toBeNull() and getAttribute() only.

function handoff(
  overrides: Partial<ProjectHandoffResponse> = {},
): ProjectHandoffResponse {
  // Annotated rather than cast: the return type contextually types the literal
  // artifact names, so a typo in `present`/`missing` is a compile error here
  // instead of a silently-wrong fixture.
  return {
    source: "handoff-artifacts",
    verdict: "ingested",
    exitCode: null,
    projectName: "Acme Checkout",
    layoutExcerpt: "contexts:\n  orders: {}\n",
    filesScanned: null,
    reportMarkdown: "# Conformance\n\n2 violations\n",
    errorMessage: null,
    artifacts: {
      present: ["hexagen-report.md", "layout.yaml"],
      missing: ["manifest.yaml"],
      reportHtmlPresent: false,
      manifestExcerpt: null,
      suppressions: [],
      suppressionCount: 3,
      baselineVersion: 1,
      baselineEntryCount: 12,
    },
    warnings: [],
    ...overrides,
  };
}

function renderView(
  overrides: Omit<Partial<ArtifactUploadViewProps>, "onFilesSelected"> = {},
) {
  const onFilesSelected = vi.fn();
  render(
    <ArtifactUploadView
      projectName="Acme Checkout"
      selectedFiles={overrides.selectedFiles ?? []}
      onFilesSelected={onFilesSelected}
      busy={overrides.busy ?? false}
      statusMessage={overrides.statusMessage ?? ""}
      alert={overrides.alert ?? null}
      result={overrides.result ?? null}
    />,
  );
  return { onFilesSelected };
}

describe("ArtifactUploadView", () => {
  it("exposes the upload control as a labelled, keyboard-reachable input", () => {
    renderView();
    const input = screen.getByLabelText(
      /Handoff zip, or the individual artifact files/i,
    ) as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("file");
    // A real <input> is in the tab order without a tabindex; a div-with-onClick
    // drop zone is the pattern this deliberately avoids.
    expect(input.getAttribute("tabindex")).toBeNull();
    expect(input.disabled).toBe(false);
    // The help text is wired up, so the instructions are announced with the
    // control rather than being visually adjacent only.
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("disables the control while a request is in flight", () => {
    renderView({ busy: true });
    const input = screen.getByLabelText(
      /Handoff zip, or the individual artifact files/i,
    ) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("raises every selected file to the host", async () => {
    const user = userEvent.setup();
    const { onFilesSelected } = renderView();
    const input = screen.getByLabelText(
      /Handoff zip, or the individual artifact files/i,
    );
    await user.upload(
      input,
      new File(["PK"], "hexagen-handoff.zip", {
        type: "application/zip",
      }),
    );
    expect(onFilesSelected).toHaveBeenCalledTimes(1);
    const raised = onFilesSelected.mock.calls[0][0] as File[];
    expect(raised.length).toBe(1);
    expect(raised[0].name).toBe("hexagen-handoff.zip");
  });

  it("always mounts a polite live region so progress is announced", () => {
    // Mounted even when empty: a live region created at the same moment as its
    // first message is frequently never announced.
    renderView();
    const region = document.body.querySelector('[role="status"]');
    expect(region).toBeTruthy();
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });

  it("announces the status message it is given", () => {
    renderView({ statusMessage: "Parsing the handoff artifacts…" });
    const region = document.body.querySelector('[role="status"]');
    expect(region?.textContent).toBe("Parsing the handoff artifacts…");
  });

  it("shows an empty state before anything is selected", () => {
    renderView();
    expect(
      screen.getByRole("heading", { name: "Nothing uploaded yet" }),
    ).toBeTruthy();
    expect(document.body.textContent).toMatch(/hexagen scan --handoff/);
  });

  it("renders a supplied alert as an alert, with its detail and hint", () => {
    renderView({
      alert: {
        title: "That upload is too large",
        detail: "Handoff zip is too large (exceeds 2,097,152 bytes)",
        hint: "A handoff bundle is a handful of small text files.",
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/That upload is too large/);
    expect(alert.textContent).toMatch(/exceeds 2,097,152 bytes/);
    expect(alert.textContent).toMatch(/handful of small text files/);
  });

  it("renders the report, the layout excerpt and the counts on success", () => {
    renderView({ result: handoff() });
    expect(screen.getByText("Artifacts ingested")).toBeTruthy();
    expect(document.body.textContent).toMatch(/2 violations/);
    expect(document.body.textContent).toMatch(/contexts:/);
    expect(document.body.textContent).toMatch(/3 suppressions/);
    expect(document.body.textContent).toMatch(/12 baselined findings/);
  });

  it("states plainly that nothing was executed", () => {
    // Tier B prints an exit code here. Printing one for a run that never
    // happened is the fabricated-verdict failure this screen exists to avoid.
    renderView({ result: handoff() });
    expect(document.body.textContent).toMatch(/nothing was executed/i);
    expect(document.body.textContent).not.toMatch(/exited \d/);
  });

  it("names the artifacts that were absent from the upload", () => {
    renderView({ result: handoff() });
    expect(document.body.textContent).toMatch(
      /Not in the upload: manifest\.yaml/,
    );
  });

  it("surfaces an incomplete handoff without claiming a scan verdict", () => {
    renderView({
      result: handoff({
        verdict: "incomplete",
        reportMarkdown: null,
        errorMessage:
          "The upload contained no hexagen-report.md. Re-run `hexagen scan --handoff` and upload the zip it produces.",
      }),
    });
    expect(screen.getByText("Handoff was incomplete")).toBeTruthy();
    expect(document.body.textContent).toMatch(/no hexagen-report\.md/);
    // Never the Tier-B vocabulary: this route ran no linter, so "pass",
    // "violations" and "could not run" are all verdicts it cannot hold.
    expect(document.body.textContent).not.toMatch(/Could not run scan/);
    expect(document.body.textContent).not.toMatch(/Scan passed/);
  });

  it("lists non-fatal parse warnings", () => {
    renderView({
      result: handoff({
        warnings: [
          "suppression-ledger.json was truncated to the display limit.",
        ],
      }),
    });
    expect(document.body.textContent).toMatch(/truncated to the display limit/);
  });

  it("renders the report as preformatted text, never as markup", () => {
    // The route refuses to return hexagen-report.html because the upload is
    // attacker-supplied. Rendering the Markdown as HTML would re-open that.
    renderView({
      result: handoff({ reportMarkdown: "<img src=x onerror=alert(1)>" }),
    });
    expect(document.body.querySelector("pre")).toBeTruthy();
    expect(document.body.querySelector("pre img")).toBeNull();
    expect(document.body.textContent).toMatch(/<img src=x onerror=alert\(1\)>/);
  });
});
