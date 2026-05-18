import React from "react";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportProjectSpecPage from "../ImportProjectSpecPage";
import fs from "node:fs";
import path from "node:path";
import { rest } from "msw";
import { setupServer } from "msw/node";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/agentic-interaction/src/application/use-cases/staged-generation/__tests__/fixtures",
);
const yamlPath = path.join(fixturesDir, "krakowski-portal.yaml");

const server = setupServer(
  rest.post("/api/manifest/generate/spec", async (req, res, ctx) => {
    const { config } = await req.json();
    if (!config) {
      return res(
        ctx.status(400),
        ctx.json({ type: "error", message: "Missing config" }),
      );
    }
    return res(
      ctx.status(200),
      ctx.body(
        'data: {"type":"stage-start","stage":0}\n' +
          'data: {"type":"stage-complete","stage":0}\n' +
          'data: {"type":"done","yaml":"bounded_contexts:\n  - name: test\n","transactionId":"txn-123"}\n',
      ),
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
      screen.getByLabelText(/file/i) ||
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

    const fileInput = screen.getByLabelText(/file/i);
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
    const fileInput = screen.getByLabelText(/file/i);
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
    const fileInput = screen.getByLabelText(/file/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/description detected/i));
    });
  });

  it("Warning banner present in DESCRIPTION_FALLBACK", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const file = new File(["plain text"], "test.txt", { type: "text/plain" });
    const fileInput = screen.getByLabelText(/file/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/doesn't look like a structured spec/i));
    });
  });

  it("'Generate with AI instead' calls router.push('/projects/new/ai')", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const file = new File(["plain text"], "test.txt", { type: "text/plain" });
    const fileInput = screen.getByLabelText(/file/i);
    await user.upload(fileInput, file);

    const aiButton = screen.getByText(/generate with ai instead/i);
    await user.click(aiButton);

    await waitFor(() => {
      assert.ok(
        mockPush.mock.calls.some((call) => call[0] === "/projects/new/ai"),
      );
    });
  });

  it("Back from SPEC_REVIEW returns to UPLOAD state", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    const file = new File([yamlContent], "krakowski-portal.yaml", {
      type: "text/yaml",
    });
    const fileInput = screen.getByLabelText(/file/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/spec review/i));
    });

    const backButton = screen.getByText(/back/i);
    await user.click(backButton);

    await waitFor(() => {
      assert.ok(screen.getByLabelText(/file/i));
      assert.strictEqual(screen.queryByText(/spec review/i), null);
    });
  });

  it("Back from DESCRIPTION_FALLBACK returns to UPLOAD state", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const file = new File(["plain text"], "test.txt", { type: "text/plain" });
    const fileInput = screen.getByLabelText(/file/i);
    await user.upload(fileInput, file);

    await waitFor(() => {
      assert.ok(screen.getByText(/description detected/i));
    });

    const backButton = screen.getByText(/back/i);
    await user.click(backButton);

    await waitFor(() => {
      assert.ok(screen.getByLabelText(/file/i));
      assert.strictEqual(screen.queryByText(/description detected/i), null);
    });
  });

  it("renders manifest preview after generating from spec", async () => {
    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    const file = new File([yamlContent], "krakowski-portal.yaml", {
      type: "text/yaml",
    });
    const fileInput = screen.getByLabelText(/file/i);
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

  it("shows error on invalid config during generation", async () => {
    server.use(
      rest.post("/api/manifest/generate/spec", (req, res, ctx) => {
        return res(ctx.status(400), ctx.json({ message: "Missing config" }));
      }),
    );

    const user = userEvent.setup();
    render(<ImportProjectSpecPage />);
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");
    const file = new File([yamlContent], "krakowski-portal.yaml", {
      type: "text/yaml",
    });
    const fileInput = screen.getByLabelText(/file/i);
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
});
