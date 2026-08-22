import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BrownfieldImportPage } from "../BrownfieldImportPage";

// jest-dom is NOT registered by apps/web/vitest.setup.ts — toBeTruthy(),
// toBeNull() and getAttribute() only. React is not imported: the Vitest config
// compiles JSX with the automatic runtime and an unused binding is a
// pre-commit ESLint error.

const routerPush = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => new URLSearchParams("name=Acme 0"));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/projects/new/import/artifacts",
  useSearchParams: () => searchParams,
  useParams: () => ({}),
}));

/**
 * A fresh carried name per test.
 *
 * `getBrownfieldDraftStore` memoises one store per seed in a MODULE-level
 * registry with its own snapshot cache, so clearing `localStorage` between
 * tests would not invalidate it and a draft saved by one test would leak into
 * the next. A distinct seed sidesteps the shared cache entirely.
 */
let seed = 0;
function currentName(): string {
  return `Acme ${seed}`;
}

const HANDOFF_OK = {
  source: "handoff-artifacts",
  verdict: "ingested",
  exitCode: null,
  projectName: "Acme",
  layoutExcerpt: "contexts:\n  orders: {}\n",
  filesScanned: null,
  reportMarkdown: "# Conformance report\n\n2 violations\n",
  errorMessage: null,
  artifacts: {
    present: ["hexagen-report.md", "layout.yaml"],
    missing: [],
    reportHtmlPresent: false,
    manifestExcerpt: null,
    suppressions: [],
    suppressionCount: 0,
    baselineVersion: null,
    baselineEntryCount: null,
  },
  warnings: [],
};

function reply(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(response: Response | Error) {
  const mock =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

const ZIP = () =>
  new File(["PK"], "hexagen-handoff.zip", {
    type: "application/zip",
  });

/** Walk S1 -> the upload screen the way a user does. */
async function gotoUpload(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: /Artifacts only/ }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return screen.getByLabelText(
    /Handoff zip, or the individual artifact files/i,
  );
}

describe("BrownfieldImportPage", () => {
  beforeEach(() => {
    seed += 1;
    searchParams.set("name", currentName());
    routerPush.mockReset();
    routerReplace.mockReset();
    stubFetch(reply(200, HANDOFF_OK));
  });

  describe("S1 — the tier picker", () => {
    it("is the first screen, and Continue is inert until a tier is picked", () => {
      render(<BrownfieldImportPage />);
      expect(
        screen.getByRole("heading", {
          name: "How should we read your codebase?",
        }),
      ).toBeTruthy();
      const cont = screen.getByRole("button", {
        name: "Continue",
      }) as HTMLButtonElement;
      expect(cont.disabled).toBe(true);
    });

    it("sends the zip tier to the Tier-C screen that already ships, carrying the name", async () => {
      const user = userEvent.setup();
      render(<BrownfieldImportPage />);
      await user.click(screen.getByRole("radio", { name: /Upload a zip/ }));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(routerPush).toHaveBeenCalledWith(
        `/projects/new/import/scan?name=${encodeURIComponent(currentName())}`,
      );
    });

    it("opens the upload screen for the artifacts tier without touching the network", async () => {
      const user = userEvent.setup();
      render(<BrownfieldImportPage />);
      await gotoUpload(user);
      expect(
        screen.getByRole("heading", { name: "Upload your scan artifacts" }),
      ).toBeTruthy();
      expect(vi.mocked(fetch).mock.calls.length).toBe(0);
    });

    it("redirects to the shared name step when no name was carried in", async () => {
      searchParams.delete("name");
      render(<BrownfieldImportPage />);
      await waitFor(() => {
        expect(routerReplace).toHaveBeenCalledWith(
          "/projects/new/name?path=artifacts",
        );
      });
      searchParams.set("name", currentName());
    });
  });

  describe("the upload itself", () => {
    it("posts a lone zip as the `zip` part, with the carried name", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(reply(200, HANDOFF_OK));
      render(<BrownfieldImportPage />);
      const input = await gotoUpload(user);
      await user.upload(input, ZIP());
      await user.click(
        screen.getByRole("button", { name: "Upload and parse" }),
      );

      await waitFor(() => {
        expect(fetchMock.mock.calls.length).toBe(1);
      });
      expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/scan/artifacts");
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe("POST");
      const form = init.body as FormData;
      expect(form.get("name")).toBe(currentName());
      expect((form.get("zip") as File).name).toBe("hexagen-handoff.zip");
      expect(form.get("files")).toBeNull();
    });

    it("posts several loose artifacts as `files` parts", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(reply(200, HANDOFF_OK));
      render(<BrownfieldImportPage />);
      const input = await gotoUpload(user);
      await user.upload(input, [
        new File(["# report"], "hexagen-report.md", { type: "text/markdown" }),
        new File(["contexts: {}"], "layout.yaml", { type: "text/yaml" }),
      ]);
      await user.click(
        screen.getByRole("button", { name: "Upload and parse" }),
      );

      await waitFor(() => {
        expect(fetchMock.mock.calls.length).toBe(1);
      });
      const form = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
      expect(form.getAll("files").length).toBe(2);
      expect(form.get("zip")).toBeNull();
    });

    it("refuses a zip mixed with loose files before spending a round trip", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch(reply(200, HANDOFF_OK));
      render(<BrownfieldImportPage />);
      const input = await gotoUpload(user);
      await user.upload(input, [
        ZIP(),
        new File(["# report"], "hexagen-report.md", { type: "text/markdown" }),
      ]);
      await user.click(
        screen.getByRole("button", { name: "Upload and parse" }),
      );

      expect(screen.getByRole("alert").textContent).toMatch(
        /Select the handoff zip on its own/,
      );
      expect(fetchMock.mock.calls.length).toBe(0);
    });

    it("renders the report and does NOT navigate away from it", async () => {
      const user = userEvent.setup();
      stubFetch(reply(200, HANDOFF_OK));
      render(<BrownfieldImportPage />);
      const input = await gotoUpload(user);
      await user.upload(input, ZIP());
      await user.click(
        screen.getByRole("button", { name: "Upload and parse" }),
      );

      await waitFor(() => {
        expect(screen.getByText("Artifacts ingested")).toBeTruthy();
      });
      expect(document.body.textContent).toMatch(/2 violations/);
      // The house rule: a flow that ends on a result screen never pushes from
      // the success arm. The user leaves by pressing something.
      expect(routerPush).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Back to import options" }),
      ).toBeTruthy();
    });

    it("announces the outcome in a live region, not only visually", async () => {
      const user = userEvent.setup();
      stubFetch(reply(200, HANDOFF_OK));
      render(<BrownfieldImportPage />);
      const input = await gotoUpload(user);
      await user.upload(input, ZIP());
      await user.click(
        screen.getByRole("button", { name: "Upload and parse" }),
      );

      await waitFor(() => {
        const region = document.body.querySelector('[role="status"]');
        expect(region?.textContent).toMatch(/Artifacts ingested/);
      });
    });

    it("surfaces an incomplete handoff rather than pretending it passed", async () => {
      const user = userEvent.setup();
      stubFetch(
        reply(200, {
          ...HANDOFF_OK,
          verdict: "incomplete",
          reportMarkdown: null,
          errorMessage:
            "The upload contained no hexagen-report.md. Re-run `hexagen scan --handoff` and upload the zip it produces.",
          artifacts: {
            ...HANDOFF_OK.artifacts,
            missing: ["hexagen-report.md"],
          },
        }),
      );
      render(<BrownfieldImportPage />);
      const input = await gotoUpload(user);
      await user.upload(input, ZIP());
      await user.click(
        screen.getByRole("button", { name: "Upload and parse" }),
      );

      await waitFor(() => {
        expect(screen.getByText("Handoff was incomplete")).toBeTruthy();
      });
      expect(document.body.textContent).toMatch(/no hexagen-report\.md/);
    });
  });

  describe("every status the route can return", () => {
    async function upload(response: Response | Error) {
      const user = userEvent.setup();
      stubFetch(response);
      render(<BrownfieldImportPage />);
      const input = await gotoUpload(user);
      await user.upload(input, ZIP());
      await user.click(
        screen.getByRole("button", { name: "Upload and parse" }),
      );
      return user;
    }

    it("400 — blocks the run and repeats the route's own message", async () => {
      await upload(
        reply(400, {
          error:
            "No hexagen handoff artifacts were uploaded. Upload the zip produced by `hexagen scan --handoff`, or its files.",
          reason: "no-artifacts",
        }),
      );
      await waitFor(() => {
        expect(
          screen.getByRole("heading", {
            name: "That upload could not be used",
          }),
        ).toBeTruthy();
      });
      // Verbatim, because the route's wording is more specific than anything
      // this screen could paraphrase.
      expect(document.body.textContent).toMatch(
        /No hexagen handoff artifacts were uploaded/,
      );
      expect(
        screen.getByRole("button", { name: "Try another way" }),
      ).toBeTruthy();
    });

    it("413 — blocks, and points at the tier that accepts a big archive", async () => {
      await upload(
        reply(413, {
          error: "Request body is too large (exceeds 2,359,296 bytes)",
        }),
      );
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "That upload is too large" }),
        ).toBeTruthy();
      });
      expect(document.body.textContent).toMatch(/exceeds 2,359,296 bytes/);
      expect(document.body.textContent).toMatch(/'Upload a zip' tier/);
    });

    it("403 — stays put and explains the origin check", async () => {
      await upload(
        reply(403, { success: false, error: "Cross-origin request rejected" }),
      );
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(
          /not accepted from this page/,
        );
      });
      // Not `blocked`: pressing the same button again is a perfectly reasonable
      // recovery, so the upload screen must still be there.
      expect(
        screen.getByRole("button", { name: "Upload and parse" }),
      ).toBeTruthy();
    });

    it("429 — stays put and quotes Retry-After in seconds", async () => {
      await upload(
        reply(
          429,
          { success: false, error: "Too many requests. Please slow down." },
          { "Retry-After": "37" },
        ),
      );
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(
          /Too many uploads in a short time/,
        );
      });
      expect(screen.getByRole("alert").textContent).toMatch(
        /Try again in about 37 seconds/,
      );
    });

    it("429 without a Retry-After header degrades to a vaguer instruction", async () => {
      await upload(reply(429, { success: false, error: "Too many requests." }));
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(
          /Wait a moment and try again/,
        );
      });
    });

    it("500 — stays put, says nothing was saved", async () => {
      await upload(
        reply(500, {
          error: "Could not parse the uploaded handoff artifacts.",
        }),
      );
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(
          /We could not parse those artifacts/,
        );
      });
      expect(screen.getByRole("alert").textContent).toMatch(
        /Nothing was saved/,
      );
    });

    it("an unrecognised status still yields actionable copy", async () => {
      await upload(reply(418, null));
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(
          /The server responded with HTTP 418/,
        );
      });
    });

    it("a 200 with an unexpected body is not treated as a result", async () => {
      await upload(reply(200, { hello: "world" }));
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(
          /unexpected response/,
        );
      });
      expect(screen.queryByText("Artifacts ingested")).toBeNull();
    });

    it("a fetch that never reached the server says so", async () => {
      await upload(new TypeError("Failed to fetch"));
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(
          /Could not reach the server/,
        );
      });
      expect(screen.getByRole("alert").textContent).toMatch(
        /Nothing was uploaded/,
      );
    });
  });

  describe("recovery out of `blocked`", () => {
    it("walks back to the tier picker, which is the machine's own recovery edge", async () => {
      const user = userEvent.setup();
      stubFetch(reply(400, { error: "Upload must be a .zip archive" }));
      render(<BrownfieldImportPage />);
      const input = await gotoUpload(user);
      await user.upload(input, ZIP());
      await user.click(
        screen.getByRole("button", { name: "Upload and parse" }),
      );

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Try another way" }),
        ).toBeTruthy();
      });
      await user.click(screen.getByRole("button", { name: "Try another way" }));

      expect(
        screen.getByRole("heading", {
          name: "How should we read your codebase?",
        }),
      ).toBeTruthy();
      // The tier is remembered, so re-entering costs one press, not three.
      expect(
        (
          screen.getByRole("radio", {
            name: /Artifacts only/,
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
    });
  });
});
