import React from "react";
import { fileURLToPath } from "node:url";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import assert from "node:assert";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportProjectSpecPage from "../ImportProjectSpecPage";
import fs from "node:fs";
import path from "node:path";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/agentic-interaction/__tests__/use-cases/staged-generation/fixtures",
);
const yamlPath = path.join(fixturesDir, "krakowski-portal.yaml");

const server = setupServer(
  http.post("/api/manifest/generate/spec", async ({ request }) => {
    const { config } = (await request.json()) as { config?: unknown };
    if (!config) {
      return HttpResponse.json(
        { type: "error", message: "Missing config" },
        { status: 400 },
      );
    }
    return new HttpResponse(
      'data: {"type":"stage-start","stage":0}\n' +
        'data: {"type":"stage-complete","stage":0}\n' +
        'data: {"type":"done","yaml":"bounded_contexts:\n  - name: test\n","transactionId":"txn-123"}\n',
      { status: 200 },
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
beforeEach(() => server.resetHandlers());

describe("ImportProjectSpecPage", () => {
  it("test file loads without error", () => {
    assert.ok(true);
  });

  it("Initial state: file input rendered, no warning banner", () => {
    render(<ImportProjectSpecPage />);
    assert.ok(
      screen.getByLabelText(/upload project specification/i) ||
        screen.getByText(/upload a yaml or json/i),
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
  // "Response body is empty" before the flow can settle. The first also asserts a
  // since-removed inline preview screen — the success path now navigates to
  // /projects/new/ai/accept (ImportProjectSpecPage acceptManifest). Kept here,
  // skipped, to document the intended behaviour until the streaming env is solved.
  it.skip("renders manifest preview after generating from spec", async () => {
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
      assert.ok(screen.getByText(/manifest preview/i));
      assert.ok(screen.getByText(/bounded_contexts/i));
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
