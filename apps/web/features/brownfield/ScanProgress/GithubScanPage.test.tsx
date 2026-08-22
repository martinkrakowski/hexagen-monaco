import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GithubScanPage } from "./GithubScanPage";

// jest-dom is NOT registered by apps/web/vitest.setup.ts — toBeTruthy(),
// toBeNull() and getAttribute() only. React is deliberately not imported: the
// Vitest config compiles JSX with the automatic runtime, and an unused binding
// is a pre-commit ESLint error.

const routerPush = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => new URLSearchParams(""));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/projects/new/import/github",
  useSearchParams: () => searchParams,
  useParams: () => ({}),
}));

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function frame(payload: Record<string, unknown>): string {
  return `${JSON.stringify({ runId: "run-1", ...payload })}\n`;
}

function streamOf(lines: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of lines) controller.enqueue(encode(chunk));
      controller.close();
    },
  });
}

function fakeResponse(
  init: {
    status?: number;
    body?: ReadableStream<Uint8Array> | null;
    text?: string;
  } = {},
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: init.body ?? null,
    headers: new Headers(),
    text: async () => init.text ?? "",
  } as unknown as Response;
}

const DONE_RESULT = {
  verdict: "violations",
  exitCode: 1,
  projectName: "checkout",
  layoutExcerpt: "contexts:\n  orders: {}",
  filesScanned: 2481,
  reportMarkdown: "# report",
  errorMessage: null,
};

const HAPPY_STREAM = () => [
  frame({
    type: "stage-start",
    stage: 0,
    label: "Clone",
    repo: "acme/checkout",
    ref: "main",
  }),
  frame({ type: "chunk", stage: 0, data: "remote: Enumerating objects: 2481" }),
  frame({ type: "stage-complete", stage: 0, durationMs: 1900 }),
  frame({ type: "stage-start", stage: 1, label: "Scan" }),
  frame({ type: "stage-complete", stage: 1, durationMs: 4200 }),
  frame({ type: "done", result: DONE_RESULT }),
];

let fetchMock: ReturnType<typeof vi.fn>;

/** Probe answer (GET) plus the POST answer. */
function stubFetch(post: () => Response, probeStatus = 405) {
  fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(
      (init?.method ?? "GET") === "GET"
        ? fakeResponse({ status: probeStatus })
        : post(),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function postCalls() {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "POST",
  );
}

beforeEach(() => {
  routerPush.mockReset();
  stubFetch(() => fakeResponse({ body: streamOf(HAPPY_STREAM()) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The `<form>` the footer's submit button owns via its `form` attribute. */
function formElement(): HTMLFormElement {
  const form = document.querySelector("form");
  if (form === null) throw new Error("the repo-entry form is not rendered");
  return form;
}

/**
 * Render and wait for the availability probe to settle.
 *
 * Waiting is not incidental tidying: the submit button is disabled while the
 * probe is in flight (there is no point letting someone start a scan against an
 * endpoint we are still asking about), so the enable transition is both the
 * signal that the probe finished and an assertion worth making.
 */
async function renderPage() {
  render(<GithubScanPage />);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Start scan" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}

describe("GithubScanPage — the kill switch", () => {
  it("says the endpoint is switched off rather than showing a form that must fail", async () => {
    stubFetch(() => fakeResponse({ status: 404 }), 404);
    render(<GithubScanPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/Scanning a GitHub repository is not available here/),
      ).toBeTruthy(),
    );
    // Not "something went wrong", and no retry affordance for a feature that
    // does not exist in this deployment.
    expect(screen.getByText(/switched off, not broken/)).toBeTruthy();
    expect(screen.queryByLabelText("Repository")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start scan" })).toBeNull();
    expect(postCalls()).toHaveLength(0);
  });
});

describe("GithubScanPage — the entry form", () => {
  it("starts on the repo-entry screen without needing the name step", async () => {
    await renderPage();
    expect(screen.getByLabelText("Repository")).toBeTruthy();
    expect(screen.getByLabelText("Project name")).toBeTruthy();
    expect(screen.getByLabelText("Branch or tag")).toBeTruthy();
  });

  it("wires the footer's submit button to the form it is not inside", async () => {
    await renderPage();
    const button = screen.getByRole("button", { name: "Start scan" });
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.getAttribute("form")).toBe(formElement().getAttribute("id"));
  });

  it("suggests the project name from the repository until the user types one", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.type(
      screen.getByLabelText("Repository"),
      "acme/checkout-service",
    );
    expect(
      (screen.getByLabelText("Project name") as HTMLInputElement).value,
    ).toBe("checkout-service");

    await user.clear(screen.getByLabelText("Project name"));
    await user.type(screen.getByLabelText("Project name"), "Billing");
    await user.type(screen.getByLabelText("Repository"), "-two");
    // The suggestion never overwrites a name the user chose.
    expect(
      (screen.getByLabelText("Project name") as HTMLInputElement).value,
    ).toBe("Billing");
  });

  it("answers an incomplete form instead of leaving a dead button", async () => {
    await renderPage();
    fireEvent.submit(formElement());
    expect(screen.getByRole("alert").textContent).toBe(
      "Enter a repository to scan.",
    );
    expect(postCalls()).toHaveLength(0);
  });

  it("advises on a non-GitHub host as it is typed, without a round trip", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.type(
      screen.getByLabelText("Repository"),
      "https://gitlab.com/acme/checkout",
    );
    expect(
      screen.getByText(/Only github\.com repositories can be scanned here/),
    ).toBeTruthy();
    expect(postCalls()).toHaveLength(0);
  });
});

describe("GithubScanPage — a run that finishes", () => {
  it("streams, shows the result, and does NOT navigate away from it", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.type(screen.getByLabelText("Repository"), "acme/checkout");
    // Clicked, not submitted programmatically: the footer button lives OUTSIDE
    // the form and reaches it through the `form` attribute, so this is the one
    // test that exercises that association end to end.
    await user.click(screen.getByRole("button", { name: "Start scan" }));

    await waitFor(() =>
      expect(screen.getByText("Scan found violations")).toBeTruthy(),
    );
    expect(screen.getByText("Scanning acme/checkout @ main")).toBeTruthy();
    // The clone's own output, verbatim.
    expect(screen.getByText(/remote: Enumerating objects: 2481/)).toBeTruthy();

    // The standing house rule: a flow that ends on a log/telemetry surface
    // never routes away from it. The user leaves by pressing something.
    expect(routerPush).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Back to import options" }),
    ).toBeTruthy();
  });

  it("can start another scan after a SUCCESSFUL one", async () => {
    // Regression. `scanning` has exactly two outgoing edges (`layout_ratify`
    // and `blocked`), so folding TRY_ANOTHER_TIER + SELECT_TIER from a
    // completed run is rejected by the machine and returns `scanning`
    // unchanged — the button was inert. A completed scan is re-entered, not
    // transitioned back through.
    const user = userEvent.setup();
    await renderPage();
    await user.type(screen.getByLabelText("Repository"), "acme/checkout");
    fireEvent.submit(formElement());
    await waitFor(() =>
      expect(screen.getByText("Scan found violations")).toBeTruthy(),
    );

    await user.click(
      screen.getByRole("button", { name: "Scan a different repository" }),
    );
    expect(screen.getByLabelText("Repository")).toBeTruthy();
    // The typed reference survives, because "a different repository" almost
    // always means editing this one.
    expect(
      (screen.getByLabelText("Repository") as HTMLInputElement).value,
    ).toBe("acme/checkout");
    // And the previous run's result is gone rather than lingering under a form.
    expect(screen.queryByText("Scan found violations")).toBeNull();
  });

  it("posts exactly one scan for one submit", async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.type(screen.getByLabelText("Repository"), "acme/checkout");
    fireEvent.submit(formElement());
    await waitFor(() =>
      expect(screen.getByText("Scan found violations")).toBeTruthy(),
    );
    expect(postCalls()).toHaveLength(1);
    expect(JSON.parse(String(postCalls()[0][1].body))).toEqual({
      name: "checkout",
      repoUrl: "acme/checkout",
    });
  });
});

describe("GithubScanPage — a run that is blocked", () => {
  it("shows the failure, offers another tier, and keeps no result", async () => {
    stubFetch(() =>
      fakeResponse({
        body: streamOf([
          frame({ type: "stage-start", stage: 0, label: "Clone" }),
          frame({
            type: "error",
            code: "clone_failed",
            message: "The repository could not be cloned.",
            reason: "preflight",
          }),
        ]),
      }),
    );

    const user = userEvent.setup();
    await renderPage();
    await user.type(screen.getByLabelText("Repository"), "acme/private-repo");
    fireEvent.submit(formElement());

    await waitFor(() =>
      expect(
        screen.getAllByText("That repository could not be cloned").length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByText(/has to be PUBLIC/)).toBeTruthy();
    expect(screen.queryByText("Scan found violations")).toBeNull();

    // "blocked" is recoverable: a different repository, or a different tier.
    const another = screen.getByRole("button", {
      name: "Scan a different repository",
    });
    expect(
      screen.getByRole("button", { name: "Try another way" }),
    ).toBeTruthy();

    await user.click(another);
    // Back on the form, with what was typed still there.
    expect(
      (screen.getByLabelText("Repository") as HTMLInputElement).value,
    ).toBe("acme/private-repo");
  });

  it("reports a stream that dies mid-clone as a stopped run, not a hang", async () => {
    stubFetch(() =>
      fakeResponse({
        body: streamOf([
          frame({ type: "stage-start", stage: 0, label: "Clone" }),
        ]),
      }),
    );

    const user = userEvent.setup();
    await renderPage();
    await user.type(screen.getByLabelText("Repository"), "acme/checkout");
    fireEvent.submit(formElement());

    await waitFor(() =>
      expect(
        screen.getAllByText("The scan stopped before it finished").length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByText(/counted against today's scan limit/)).toBeTruthy();
  });
});
