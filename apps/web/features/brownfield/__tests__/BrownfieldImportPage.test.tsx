import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BrownfieldImportPage, looksLikeZip } from "../BrownfieldImportPage";

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

  describe("review fixes (#595)", () => {
    it("treats a 200 with a malformed artifacts object as an unexpected response", async () => {
      // The guard checked `typeof artifacts === "object"` but not that
      // `present`/`missing` are arrays -- and the render path reads
      // `artifacts.present.length`. So the shape that actually crashed was the
      // one the guard let through.
      const user = userEvent.setup();
      render(<BrownfieldImportPage />);
      const input = await gotoUpload(user);
      stubFetch(
        reply(200, {
          ...HANDOFF_OK,
          artifacts: { reportHtmlPresent: false },
        }),
      );
      await user.upload(input, ZIP());
      await user.click(screen.getByRole("button", { name: /Upload/i }));

      await waitFor(() => {
        // Appears twice by design: once in the alert, once in the polite
        // live region. Asserting "at least one" rather than "exactly one".
        expect(
          screen.getAllByText(/returned an unexpected response/i).length,
        ).toBeGreaterThan(0);
      });
    });

    it("routes an unambiguous zip media type without a .zip name as the zip part", () => {
      // `.json` is in the input's accept list, so this file can actually be
      // staged; its NAME does not end in .zip, so only the media-type branch
      // can classify it.
      expect(
        looksLikeZip(new File(["PK"], "handoff.json", { type: "application/zip" })),
      ).toBe(true);
    });

    it("does NOT route an octet-stream file as a zip", () => {
      // The server's isZipFile accepts octet-stream, but it only ever runs on
      // a file already in the zip field. Copying that permissiveness into the
      // client's ROUTING decision would send a single manifest.yaml — which
      // browsers often report as octet-stream — into the zip slot, where the
      // server would fail to unzip it. A regression on the common path to fix
      // a rare one.
      expect(
        looksLikeZip(
          new File(["x"], "manifest.yaml", { type: "application/octet-stream" }),
        ),
      ).toBe(false);
      expect(
        looksLikeZip(new File(["PK"], "handoff.zip", { type: "application/octet-stream" })),
      ).toBe(true);
    });

    it("gives size-specific guidance when a 400 says the zip is too large", async () => {
      // The route returns 400 for BOTH a malformed handoff and an oversized
      // one, so a single hint was wrong for one of them.
      const user = userEvent.setup();
      render(<BrownfieldImportPage />);
      const input = await gotoUpload(user);
      stubFetch(
        reply(400, { error: "Handoff zip is too large (exceeds 2,097,152 bytes)" }),
      );
      await user.upload(input, ZIP());
      await user.click(screen.getByRole("button", { name: /Upload/i }));

      await waitFor(() => {
        expect(
          screen.getAllByText(/zipped the repository/i).length,
        ).toBeGreaterThan(0);
      });
    });

    it("clears the file input on reset so the same file can be retried", async () => {
      const user = userEvent.setup();
      render(<BrownfieldImportPage />);
      const input = (await gotoUpload(user)) as HTMLInputElement;
      stubFetch(reply(200, HANDOFF_OK));
      await user.upload(input, ZIP());
      expect(input.files?.length).toBe(1);
      await user.click(screen.getByRole("button", { name: /Upload/i }));

      await waitFor(() =>
        expect(
          screen.getAllByText(/Artifacts ingested/i).length,
        ).toBeGreaterThan(0),
      );
      await user.click(
        screen.getByRole("button", { name: /Upload different artifacts/i }),
      );

      // Remounted, so the control no longer holds the previous FileList.
      const fresh = screen.getByLabelText(
        /Handoff zip, or the individual artifact files/i,
      ) as HTMLInputElement;
      expect(fresh.files?.length ?? 0).toBe(0);
    });
  });
});
