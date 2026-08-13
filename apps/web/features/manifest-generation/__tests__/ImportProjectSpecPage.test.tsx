import React from "react";
import { fileURLToPath } from "node:url";
import { describe, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import assert from "node:assert";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportProjectSpecPage from "../ImportProjectSpecPage";
import { usePendingManifest } from "../store/usePendingManifest";
import fs from "node:fs";
import path from "node:path";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// Override the global next/navigation stub (vitest.setup) with a STABLE `push`
// spy so the generation test can assert the post-success navigation; the other
// hooks mirror the global stub. Reset in beforeEach.
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/agentic-interaction/__tests__/use-cases/staged-generation/fixtures",
);
const yamlPath = path.join(fixturesDir, "krakowski-portal.yaml");

const server = setupServer(
  http.post("/api/manifest/generate/spec", async ({ request }) => {
    const { config } = (await request.json()) as { config?: unknown };
    if (typeof config !== "string" || config.length === 0) {
      return HttpResponse.json(
        { type: "error", message: "Missing config" },
        { status: 400 },
      );
    }
    // Raw NDJSON (one JSON object per line) — the production route emits
    // `application/x-ndjson` and the client (useStagedGenerationStream)
    // `JSON.parse()`s each line directly; there is no SSE `data:` prefix, and
    // the `done` frame carries the count + validation fields the UI reads.
    return new HttpResponse(
      JSON.stringify({ type: "stage-start", stage: 0 }) +
        "\n" +
        JSON.stringify({ type: "stage-complete", stage: 0, durationMs: 1 }) +
        "\n" +
        JSON.stringify({
          type: "done",
          yaml: "bounded_contexts:\n  - name: test\n",
          contextCount: 1,
          portCount: 0,
          adapterCount: 0,
          transactionId: "txn-123",
          validation: { errors: [], warnings: [], passed: true },
        }) +
        "\n",
      { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
    );
  }),
  http.post("/api/manifest/generate/spec/convert", async () => {
    return new HttpResponse(
      '{"type":"done","configJson":"{\\"bounded_contexts\\":[{\\"name\\":\\"test\\"}]}"}\n',
      { status: 200 },
    );
  }),
);

beforeAll(() => {
  server.listen();
  // The page's generation/conversion hooks resolve their execution strategy via
  // resolveExecutionStrategy(hasLocalLLM, hasCloudKeys). In the test env no
  // WebLLM model is loaded (hasLocalLLM=false) and the cloud flag is unset, so
  // "auto" resolves to "none" and the flow errors *before* any fetch — the msw
  // mocks below are never reached. hasServerLLMAccessKey() reads this build-time
  // flag, so stub it "true" to exercise the cloud path the mocks serve.
  vi.stubEnv("NEXT_PUBLIC_LLM_AVAILABLE", "true");
});
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  server.resetHandlers();
  routerPush.mockClear();
});

describe("ImportProjectSpecPage", () => {
  it("test file loads without error", () => {
    assert.ok(true);
  });

  it("Initial state: file input rendered, no warning banner", () => {
    render(<ImportProjectSpecPage />);
    // getBy*/queryBy* throw (on miss / on multiple respectively), so the old
    // `getByLabelText(...) || getByText(...)` never reached its fallback. Use
    // queryAllBy* (returns [] on miss, never throws) for a real either/or — the
    // helper copy appears more than once in the upload step.
    const hasInput =
      screen.queryByLabelText(/upload manifest or spec/i) !== null;
    const hasHelper = screen.queryAllByText(/a structured/i).length > 0;
    assert.ok(
      hasInput || hasHelper,
      "upload control or its helper is rendered",
    );
    assert.strictEqual(
      screen.queryByText(/doesn't look like a structured spec/i),
      null,
    );
  });

  it("Upload a generated manifest: skips AI and routes straight to the accept screen", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    // A complete manifest carries derived hexagonal layers (ports/adapters) —
    // the importer must detect it and go straight to the accept screen, NOT the
    // spec-review / AI path.
    const manifest = [
      "system: test-system",
      "bounded_contexts:",
      "  - name: orders",
      "    layers:",
      "      application:",
      "        ports:",
      "          in: [PlaceOrderPort]",
      "          out: [OrderRepositoryPort]",
      "      infrastructure:",
      "        adapters: [OrderRepositoryAdapter]",
      "",
    ].join("\n");
    const file = new File([manifest], "manifest.yaml", { type: "text/yaml" });

    // Pre-seed a stale spec from a prior upload this session — uploading a
    // manifest must CLEAR it (not just skip persisting), so Back lands clean.
    sessionStorage.setItem("import_spec_content", "stale: spec");

    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput as HTMLElement, file);

    await waitFor(() => {
      assert.ok(
        routerPush.mock.calls.some((c) => c[0] === "/projects/new/ai/accept"),
        "a complete manifest routes straight to the accept screen",
      );
    });
    // It must NOT pass through the spec-review step.
    assert.strictEqual(screen.queryByText(/spec review/i), null);

    // Loop-fix regression: a manifest fast-path must NOT persist
    // import_spec_content. If it did, the accept screen's Back would rehydrate
    // this page from sessionStorage and immediately re-fast-path to accept — an
    // infinite Back→Accept loop. (Specs still persist; that's a separate path.)
    assert.strictEqual(
      sessionStorage.getItem("import_spec_content"),
      null,
      "a generated manifest is not persisted for rehydration",
    );
  });

  it("Upload krakowski YAML: transitions to SPEC_REVIEW", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    const file = new File([yamlContent], "krakowski-portal.yaml", {
      type: "text/yaml",
    });

    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput as HTMLElement, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/spec review/i));
    });
  });

  it("Spec summary shows correct counts for krakowski YAML", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    const file = new File([yamlContent], "krakowski-portal.yaml", {
      type: "text/yaml",
    });
    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/7 bounded contexts detected/i));
      assert.ok(screen.getByText(/\d+ aggregates/i));
      assert.ok(screen.getByText(/\d+ context mappings/i));
    });
  });

  it("Upload plain text file: transitions to DESCRIPTION_FALLBACK", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const file = new File(["Build a SaaS app"], "description.txt", {
      type: "text/plain",
    });
    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/description detected/i));
    });
  });

  it("Warning banner present in DESCRIPTION_FALLBACK", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const file = new File(["plain text"], "test.txt", { type: "text/plain" });
    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/doesn't look like a structured spec/i));
    });
  });

  it("'Generate with AI instead' button renders and is clickable", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const file = new File(["plain text"], "test.txt", { type: "text/plain" });
    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/generate with ai instead/i));
    });

    const aiButton = screen.getByText(/generate with ai instead/i);
    await user.click(aiButton);
  });

  it("Back from SPEC_REVIEW returns to UPLOAD state", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    const file = new File([yamlContent], "krakowski-portal.yaml", {
      type: "text/yaml",
    });
    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/spec review/i));
    });

    const backButton = screen.getByText(/back/i);
    await user.click(backButton);

    await waitFor(() => {
      assert.ok(screen.getByLabelText(/upload manifest or spec/i));
      assert.strictEqual(screen.queryByText(/spec review/i), null);
    });
  });

  it("Back from DESCRIPTION_FALLBACK returns to UPLOAD state", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const file = new File(["plain text"], "test.txt", { type: "text/plain" });
    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/description detected/i));
    });

    const backButton = screen.getByText(/back/i);
    await user.click(backButton);

    await waitFor(() => {
      assert.ok(screen.getByLabelText(/upload manifest or spec/i));
      assert.strictEqual(screen.queryByText(/description detected/i), null);
    });
  });

  // The remaining three drive the cloud generation / loose-spec conversion flow,
  // which streams the response via `response.body.getReader()`
  // (useLooseSpecConversion / runSpecGeneration). They were skipped on the
  // premise that jsdom exposes no readable `body` ("Response body is empty") —
  // that is NO LONGER true under Vitest 4 (undici's `Response.body` is a real
  // ReadableStream here; a probe confirmed `getReader()` works). The actual
  // blocker was provider gating: these flows call resolveExecutionStrategy(),
  // which returns "none" when neither a local model is loaded nor a cloud key is
  // present — erroring out before any fetch, so the msw mocks never ran. The
  // beforeAll stubs NEXT_PUBLIC_LLM_AVAILABLE="true" (what hasServerLLMAccessKey
  // reads) so "auto" resolves to "cloud" and exercises the mocked stream.
  // They assert the CURRENT behaviour: the generation case navigates to
  // /projects/new/ai/accept via the footer "Next" → acceptManifest (there is no
  // inline preview screen).
  it("navigates to the accept screen after generating from spec", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    const file = new File([yamlContent], "krakowski-portal.yaml", {
      type: "text/yaml",
    });
    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/spec review/i));
    });

    await user.click(screen.getByText(/map ports & adapters/i));

    // Generation completes → the footer's "Next" button carries the manifest to
    // the accept screen (acceptManifest → router.push); the old inline preview
    // screen was removed.
    await waitFor(() => {
      assert.ok(screen.getByRole("button", { name: /next/i }));
    });
    await user.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      assert.ok(
        routerPush.mock.calls.some((c) => c[0] === "/projects/new/ai/accept"),
        "navigates to the accept screen",
      );
    });
  });

  it("hands the done frame's Stage-6 report to the pending-manifest store on accept", async () => {
    // Import round-trip integrity, Item 3.1: the accept screen keys its
    // auto-fixer gate and approve logic on this report — dropping it here
    // re-enabled the client fixer's padding on server-validated manifests.
    usePendingManifest.getState().clear();
    const report = {
      errors: [],
      warnings: ["[R04] Port 'StoragePort' has no adapter."],
      passed: true,
    };
    server.use(
      http.post("/api/manifest/generate/spec", () => {
        return new HttpResponse(
          JSON.stringify({
            type: "done",
            yaml: "bounded_contexts:\n  - name: test\n",
            contextCount: 1,
            portCount: 0,
            adapterCount: 0,
            transactionId: "txn-123",
            validation: report,
          }) + "\n",
          { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
        );
      }),
    );

    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    await user.upload(
      screen.getByLabelText(/upload manifest or spec/i),
      new File([yamlContent], "krakowski-portal.yaml", { type: "text/yaml" }),
    );
    await waitFor(() => assert.ok(screen.getByText(/spec review/i)));
    await user.click(screen.getByText(/map ports & adapters/i));
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: /next/i })),
    );
    await user.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() =>
      assert.ok(
        routerPush.mock.calls.some((c) => c[0] === "/projects/new/ai/accept"),
      ),
    );
    assert.deepStrictEqual(
      usePendingManifest.getState().validationReport,
      report,
    );
  });

  it("the manifest fast path stores a NULL report — a stale one from an earlier run must not attach", async () => {
    // A hand-uploaded complete manifest never went through the pipeline; the
    // explicit-null override in handleFileLoaded keeps any report left on the
    // generation hooks (or, as seeded here, in the store) from leaking onto it.
    usePendingManifest.getState().clear();
    usePendingManifest
      .getState()
      .set("old: yaml", {} as never, "Old", "/projects/new/import/spec", null, {
        errors: [],
        warnings: [],
        passed: true,
      });

    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const manifest = [
      "system: test-system",
      "bounded_contexts:",
      "  - name: orders",
      "    layers:",
      "      application:",
      "        ports:",
      "          in: [PlaceOrderPort]",
      "          out: [OrderRepositoryPort]",
      "      infrastructure:",
      "        adapters: [OrderRepositoryAdapter]",
      "",
    ].join("\n");
    await user.upload(
      screen.getByLabelText(/upload manifest or spec/i),
      new File([manifest], "manifest.yaml", { type: "text/yaml" }),
    );

    await waitFor(() =>
      assert.ok(
        routerPush.mock.calls.some((c) => c[0] === "/projects/new/ai/accept"),
      ),
    );
    assert.strictEqual(usePendingManifest.getState().validationReport, null);
  });

  it("shows error on invalid config during generation", async () => {
    server.use(
      http.post("/api/manifest/generate/spec", () => {
        return HttpResponse.json(
          { message: "Missing config" },
          { status: 400 },
        );
      }),
    );

    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    const file = new File([yamlContent], "krakowski-portal.yaml", {
      type: "text/yaml",
    });
    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/spec review/i));
    });

    const generateButton = screen.getByText(/map ports & adapters/i);
    await user.click(generateButton);

    await waitFor(() => {
      assert.ok(screen.getByText(/error/i));
      assert.ok(screen.getByText(/missing config/i));
    });
  });

  it("Upload semi-structured spec: transitions to CONVERTING_LOOSE_SPEC then SPEC_REVIEW", async () => {
    // Hold the convert response open until the test has observed the transient
    // CONVERTING_LOOSE_SPEC screen, then release it. This is deterministic with
    // no timing dependence: an instant mock races straight past CONVERTING, and
    // a fixed delay only papers over that race (a short one is flaky, a long one
    // is a wasted sleep). The page sets CONVERTING_LOOSE_SPEC *before* it awaits
    // convert(), so the screen stays up for as long as the gated fetch is pending.
    let releaseConvert!: () => void;
    const convertGate = new Promise<void>((resolve) => {
      releaseConvert = resolve;
    });
    server.use(
      http.post("/api/manifest/generate/spec/convert", async () => {
        await convertGate;
        return new HttpResponse(
          '{"type":"done","configJson":"{\\"bounded_contexts\\":[{\\"name\\":\\"test\\"}]}"}\n',
          { status: 200 },
        );
      }),
    );

    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const looseContent =
      "We have bounded contexts, some aggregates and value objects. This should trigger the semi-structured mode.";
    const file = new File([looseContent], "loose.txt", { type: "text/plain" });

    const fileInput = screen.getByLabelText(/upload manifest or spec/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(
        screen.getByText(
          /converting loose specification into structured architecture/i,
        ),
      );
    });

    // Release the gated conversion → the flow advances to SPEC_REVIEW.
    releaseConvert();

    await waitFor(() => {
      assert.ok(screen.getByText(/spec review/i));
      assert.ok(screen.getByText(/1 bounded contexts detected/i));
    });
  });

  it("manifest fast-path after an abandoned spec upload attaches NO provenance (stale-closure regression)", async () => {
    // Pre-fix leak: upload a spec (originalSpecText set), Back (state survived),
    // then upload a generated manifest — acceptManifest's closure still saw the
    // previous upload's text and attached it to the unrelated manifest. Two
    // independent guards now close it: Back clears the state/keys, and the fast
    // path passes an explicit null override past the un-flushed setState.
    sessionStorage.clear();
    usePendingManifest.getState().clear();
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);

    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    await user.upload(
      screen.getByLabelText(/upload manifest or spec/i),
      new File([yamlContent], "krakowski-portal.yaml", { type: "text/yaml" }),
    );
    await waitFor(() => assert.ok(screen.getByText(/spec review/i)));

    await user.click(screen.getByText(/back/i));
    await waitFor(() =>
      assert.ok(screen.getByLabelText(/upload manifest or spec/i)),
    );

    const manifest = [
      "system: test-system",
      "bounded_contexts:",
      "  - name: orders",
      "    layers:",
      "      application:",
      "        ports:",
      "          in: [PlaceOrderPort]",
      "          out: [OrderRepositoryPort]",
      "      infrastructure:",
      "        adapters: [OrderRepositoryAdapter]",
      "",
    ].join("\n");
    await user.upload(
      screen.getByLabelText(/upload manifest or spec/i),
      new File([manifest], "manifest.yaml", { type: "text/yaml" }),
    );

    await waitFor(() => {
      assert.ok(
        routerPush.mock.calls.some((c) => c[0] === "/projects/new/ai/accept"),
      );
    });
    assert.strictEqual(
      usePendingManifest.getState().originSpecText,
      null,
      "a generated manifest must carry no stale spec provenance",
    );
    assert.strictEqual(
      sessionStorage.getItem("import_spec_original_content"),
      null,
    );
  });

  it("loose-spec conversion preserves the ORIGINAL text as provenance, across reload", async () => {
    // The conversion overwrites import_spec_content with the converted JSON (so
    // this step rehydrates correctly); the user's original words must live under
    // the dedicated key and win at accept time — even after unmount/remount.
    sessionStorage.clear();
    usePendingManifest.getState().clear();
    const user = userEvent.setup();
    const first = render(<ImportProjectSpecPage />);

    const looseContent =
      "We have bounded contexts, some aggregates and value objects. This should trigger the semi-structured mode.";
    await user.upload(
      screen.getByLabelText(/upload manifest or spec/i),
      new File([looseContent], "loose.txt", { type: "text/plain" }),
    );
    await waitFor(() => assert.ok(screen.getByText(/spec review/i)));

    // Storage split: current-step content = converted JSON; original preserved.
    assert.match(
      sessionStorage.getItem("import_spec_content") ?? "",
      /bounded_contexts/,
    );
    assert.strictEqual(
      sessionStorage.getItem("import_spec_original_content"),
      looseContent,
    );

    // Reload mid-import: remount rehydrates the converted step, but provenance
    // must still be the original words.
    first.unmount();
    render(<ImportProjectSpecPage />);
    await waitFor(() => assert.ok(screen.getByText(/spec review/i)));

    await user.click(screen.getByText(/map ports & adapters/i));
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: /next/i })),
    );
    await user.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => {
      assert.ok(
        routerPush.mock.calls.some((c) => c[0] === "/projects/new/ai/accept"),
      );
    });

    assert.strictEqual(
      usePendingManifest.getState().originSpecText,
      looseContent,
      "provenance is the user's original words, not the converted JSON",
    );
  });

  it("silent stream death: surfaces a failed state and the footer Retry re-runs to success", async () => {
    // First request: the NDJSON stream ends after stage-start with NO
    // done/error frame (server crash / proxy close). The page must surface a
    // failed state with a Retry button — previously this parked the spinner
    // forever. Second request (the Retry): a healthy stream.
    let requestCount = 0;
    server.use(
      http.post("/api/manifest/generate/spec", async () => {
        requestCount++;
        if (requestCount === 1) {
          return new HttpResponse(
            JSON.stringify({ type: "stage-start", stage: 0 }) + "\n",
            {
              status: 200,
              headers: { "Content-Type": "application/x-ndjson" },
            },
          );
        }
        return new HttpResponse(
          JSON.stringify({ type: "stage-start", stage: 0 }) +
            "\n" +
            JSON.stringify({
              type: "done",
              yaml: "bounded_contexts:\n  - name: test\n",
              contextCount: 1,
              portCount: 0,
              adapterCount: 0,
              validation: { errors: [], warnings: [], passed: true },
            }) +
            "\n",
          { status: 200, headers: { "Content-Type": "application/x-ndjson" } },
        );
      }),
    );

    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    await user.upload(
      screen.getByLabelText(/upload manifest or spec/i),
      new File([yamlContent], "krakowski-portal.yaml", { type: "text/yaml" }),
    );
    await waitFor(() => assert.ok(screen.getByText(/spec review/i)));
    await user.click(screen.getByText(/map ports & adapters/i));

    // Failed state with retry-oriented copy, not an endless spinner.
    await waitFor(() => {
      assert.ok(screen.getByText(/ended unexpectedly/i));
    });

    await user.click(screen.getByRole("button", { name: /retry/i }));

    // The retry replays the SAME spec request and lands the normal success
    // resting state (footer Next).
    await waitFor(() => {
      assert.ok(screen.getByRole("button", { name: /next/i }));
    });
    assert.strictEqual(requestCount, 2);
    // The error box cleared on the successful retry.
    assert.strictEqual(screen.queryByText(/ended unexpectedly/i), null);
  });
});
