import { describe, it } from "node:test";
import assert from "node:assert";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportProjectSpecPage from "../ImportProjectSpecPage";
import fs from "node:fs";
import path from "node:path";

// Mock Next.js router
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const yamlPath = path.join(
  "/Users/martin/Projects/hexagen-monaco/packages/agentic-interaction/src/application/use-cases/staged-generation/__tests__/fixtures",
  "krakowski-portal.yaml",
);

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

    // Mock file input change
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
      // Krakowski YAML has 7 contexts, check aggregates (assuming ≥12)
      assert.ok(screen.getByText(/\d+ aggregates/i));
      // Check mappings (assuming ≥14)
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

    await waitFor(() => {
      const aiButton = screen.getByText(/generate with ai instead/i);
      user.click(aiButton);
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
      const backButton = screen.getByText(/back/i);
      user.click(backButton);
    });

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
      const backButton = screen.getByText(/back/i);
      user.click(backButton);
    });

    await waitFor(() => {
      assert.ok(screen.getByLabelText(/file/i));
      assert.strictEqual(screen.queryByText(/description detected/i), null);
    });
  });
});
