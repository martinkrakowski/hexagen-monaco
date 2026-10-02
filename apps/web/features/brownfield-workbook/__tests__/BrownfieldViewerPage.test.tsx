import React from "react";
import { describe, it, vi, beforeEach, afterEach, expect } from "vitest";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
  act,
} from "@testing-library/react";
import {
  BrownfieldViewerPage,
  INTEGRITY_NOTICE,
  type IntakeState,
} from "../BrownfieldViewerPage";
import { STEP_COMMANDS } from "../steps";
import { readBundle, type LoadedBundle } from "../bundle/read-bundle";
import {
  buildBundle,
  slice,
  trace,
  validFiles,
  type FixtureFile,
} from "./bundle-fixtures";

async function load(
  files: FixtureFile[] = validFiles(),
): Promise<LoadedBundle> {
  const r = await readBundle(await buildBundle(files));
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.bundle;
}
const ready = (bundle: LoadedBundle): IntakeState => ({
  phase: "ready",
  fileName: "engagement.zip",
  bundle,
});
const page = (intake: IntakeState, onFile = vi.fn()) =>
  render(
    <BrownfieldViewerPage
      name="Client engagement"
      status="ready"
      intake={intake}
      onFile={onFile}
    />,
  );

const GRANT = STEP_COMMANDS.grant.commands[0] as string;
const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  // BW-D2: nothing in the viewer may touch the network.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("fetch must not be called");
    }),
  );
  vi.stubGlobal("XMLHttpRequest", function () {
    throw new Error("XHR must not be used");
  });
  vi.stubGlobal("WebSocket", function () {
    throw new Error("WebSocket must not be used");
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("BrownfieldViewerPage: intake", () => {
  it("offers a file picker and no step before a bundle is open", () => {
    page({ phase: "idle" });
    expect(screen.getByLabelText(/open a workbook bundle/i)).toBeTruthy();
    expect(screen.queryByTestId("step-observe")).toBeNull();
  });

  it("hands a picked file to onFile", () => {
    const onFile = vi.fn();
    page({ phase: "idle" }, onFile);
    const file = new File(["x"], "b.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText(/open a workbook bundle/i), {
      target: { files: [file] },
    });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("hands a dropped file to onFile", () => {
    const onFile = vi.fn();
    page({ phase: "idle" }, onFile);
    const file = new File(["x"], "b.zip");
    fireEvent.drop(screen.getByTestId("bundle-dropzone"), {
      dataTransfer: { files: [file] },
    });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("shows each refusal reason as text, and no steps", () => {
    page({
      phase: "refused",
      fileName: "bad.zip",
      errors: [
        'entry "x" is not listed in bundle.json',
        'listed file "y" is missing from the zip',
      ],
    });
    expect(screen.getByText(/not listed in bundle\.json/)).toBeTruthy();
    expect(screen.getByText(/missing from the zip/)).toBeTruthy();
    expect(screen.queryByTestId("step-observe")).toBeNull();
  });
});

describe("BrownfieldViewerPage: the left rail", () => {
  it("renders the six steps with their statuses and commands", async () => {
    page(ready(await load()));
    for (const id of [
      "checkout",
      "observe",
      "slice",
      "contract",
      "grant",
      "evidence",
    ]) {
      expect(
        within(screen.getByTestId(`step-${id}`)).getByText("present"),
      ).toBeTruthy();
    }
    expect(
      screen.getByText(STEP_COMMANDS.evidence.commands[0] as string),
    ).toBeTruthy();
    expect(screen.getByText(GRANT)).toBeTruthy();
  });

  it("shows Observe as incomplete when the edge list is incomplete", async () => {
    const files = validFiles().map((f) =>
      f.path === "observed.json"
        ? {
            ...f,
            content: String(f.content).replace(
              '"unreadLanguages":[]',
              '"unreadLanguages":["Go"]',
            ),
          }
        : f,
    );
    page(ready(await load(files)));
    expect(
      within(screen.getByTestId("step-observe")).getByText("incomplete"),
    ).toBeTruthy();
  });

  it("states permanently that the signature cannot be checked here", async () => {
    page(ready(await load()));
    expect(screen.getByText(INTEGRITY_NOTICE)).toBeTruthy();
    expect(INTEGRITY_NOTICE).toBe(
      "integrity: entries match the bundle index; the bundle's signature can only be checked with `hexagen` on the engagement machine.",
    );
  });

  it("labels the Evidence step as recorded by the pack, marks denials, and shows the verdict", async () => {
    page(ready(await load()));
    const ev = screen.getByTestId("step-evidence");
    expect(within(ev).getByText(/as recorded by/)).toBeTruthy();
    expect(
      within(ev)
        .getByText(/as recorded by/)
        .querySelector("code")?.textContent,
    ).toBe("hexagen evidence pack");
    expect(within(ev).getByText(/all 2 trace lines valid/i)).toBeTruthy();
    expect(within(ev).getAllByText(/denial/i).length).toBeGreaterThan(0);
    expect(within(ev).getByText(/outside the slice/)).toBeTruthy();
  });

  it("leaves named, empty slots for the middle and right panels", async () => {
    page(ready(await load()));
    expect(screen.getByTestId("slot-middle-panel").textContent).toBe("");
    expect(screen.getByTestId("slot-right-panel")).toBeTruthy(); // BW9 fills it; see RightPanel.test.tsx
  });

  it("has no chat or advance control: the only buttons are copy buttons", async () => {
    page(ready(await load()));
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(8);
    for (const n of names) expect(n).toMatch(/^Copy /);
  });
});

describe("BrownfieldViewerPage: copy", () => {
  it("copies the exact command through the clipboard only", async () => {
    page(ready(await load()));
    fireEvent.click(
      screen.getByRole("button", { name: /copy grant command/i }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(GRANT));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("resets Copied after about two seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      page(ready(await load()));
      fireEvent.click(
        screen.getByRole("button", { name: /copy grant command/i }),
      );
      expect(await screen.findByText("Copied")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(screen.queryByText("Copied")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a failed copy without any fallback", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    page(ready(await load()));
    fireEvent.click(
      screen.getByRole("button", { name: /copy grant command/i }),
    );
    expect(await screen.findByText(/copy failed/i)).toBeTruthy();
  });
});

describe("BrownfieldViewerPage: inert text", () => {
  it("renders HTML and control characters from the bundle as inert text", async () => {
    const evil = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    const files = validFiles().map((f) => {
      if (f.path === "slice.json") {
        return {
          ...f,
          content: JSON.stringify({
            ...JSON.parse(slice),
            id: "slice-1",
            repo: { commit: "abc", remote: `${evil}\u001b[2J\u0007` },
          }),
        };
      }
      if (f.path === "evidence/trace.jsonl") {
        return { ...f, content: `${evil}\u001b]0;pwn\u0007\n${trace}` };
      }
      return f;
    });
    const { container } = page(ready(await load(files)));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toMatch(/<img|<script/i);
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    // eslint-disable-next-line no-control-regex
    expect(container.textContent).not.toMatch(
      /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/,
    );
    expect(container.textContent).not.toContain("pwn");
  });
});

describe("BrownfieldViewerPage: file names", () => {
  it("strips control characters from the file name and the refusal text", () => {
    const { container } = page({
      phase: "refused",
      fileName: "a\u001b[2Jb\u0007.zip",
      errors: ["bad \u001b[31mentry\u0000"],
    });
    expect(container.textContent).toContain("ab.zip was refused");
    expect(container.textContent).toContain("bad entry");
    // eslint-disable-next-line no-control-regex
    expect(container.textContent).not.toMatch(
      /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/,
    );
  });
});

describe("BrownfieldViewerPage: states", () => {
  it("shows the not-found state for a missing project", () => {
    render(
      <BrownfieldViewerPage
        name={null}
        status="missing"
        intake={{ phase: "idle" }}
        onFile={vi.fn()}
      />,
    );
    expect(screen.getByText(/workbook not found/i)).toBeTruthy();
  });
});
