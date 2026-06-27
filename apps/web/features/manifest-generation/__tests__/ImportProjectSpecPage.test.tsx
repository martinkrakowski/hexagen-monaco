import React from "react";
import { fileURLToPath } from "node:url";
import { describe, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import assert from "node:assert";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportProjectSpecPage from "../ImportProjectSpecPage";
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
      screen.queryByLabelText(/upload project specification/i) !== null;
    const hasHelper =
      screen.queryAllByText(/upload a yaml or json/i).length > 0;
    assert.ok(
      hasInput || hasHelper,
      "upload control or its helper is rendered",
    );
    assert.strictEqual(
      screen.queryByText(/doesn't look like a structured spec/i),
      null,
    );
  });

  it("Upload krakowski YAML: transitions to SPEC_REVIEW", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    const file = new File([yamlContent], "krakowski-portal.yaml", {
      type: "text/yaml",
    });

    const fileInput = screen.getByLabelText(/upload project specification/i);
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
    const fileInput = screen.getByLabelText(/upload project specification/i);
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
    const fileInput = screen.getByLabelText(/upload project specification/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/description detected/i));
    });
  });

  it("Warning banner present in DESCRIPTION_FALLBACK", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const file = new File(["plain text"], "test.txt", { type: "text/plain" });
    const fileInput = screen.getByLabelText(/upload project specification/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/doesn't look like a structured spec/i));
    });
  });

  it("'Generate with AI instead' button renders and is clickable", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const file = new File(["plain text"], "test.txt", { type: "text/plain" });
    const fileInput = screen.getByLabelText(/upload project specification/i);
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
    const fileInput = screen.getByLabelText(/upload project specification/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/spec review/i));
    });

    const backButton = screen.getByText(/back/i);
    await user.click(backButton);

    await waitFor(() => {
      assert.ok(screen.getByLabelText(/upload project specification/i));
      assert.strictEqual(screen.queryByText(/spec review/i), null);
    });
  });

  it("Back from DESCRIPTION_FALLBACK returns to UPLOAD state", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const file = new File(["plain text"], "test.txt", { type: "text/plain" });
    const fileInput = screen.getByLabelText(/upload project specification/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/description detected/i));
    });

    const backButton = screen.getByText(/back/i);
    await user.click(backButton);

    await waitFor(() => {
      assert.ok(screen.getByLabelText(/upload project specification/i));
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
    const fileInput = screen.getByLabelText(/upload project specification/i);
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
    const fileInput = screen.getByLabelText(/upload project specification/i);
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

    const fileInput = screen.getByLabelText(/upload project specification/i);
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
});
