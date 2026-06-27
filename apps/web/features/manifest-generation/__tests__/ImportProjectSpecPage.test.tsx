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

beforeAll(() => server.listen());
afterAll(() => server.close());
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
  // (useLooseSpecConversion / runSpecGeneration). Under the jsdom test env an
  // msw-v2 mocked response exposes no readable `body`, so the stream read throws
  // "Response body is empty" before the flow can settle. They assert the CURRENT
  // behaviour (the generation case navigates to /projects/new/ai/accept via the
  // footer "Next" → acceptManifest — there is no inline preview screen) and stay
  // skipped only until the streaming env is solved.
  it.skip("navigates to the accept screen after generating from spec", async () => {
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

  it.skip("shows error on invalid config during generation", async () => {
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

  it.skip("Upload semi-structured spec: transitions to CONVERTING_LOOSE_SPEC then SPEC_REVIEW", async () => {
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

    await waitFor(() => {
      assert.ok(screen.getByText(/spec review/i));
      assert.ok(screen.getByText(/1 bounded contexts detected/i));
    });
  });
});
