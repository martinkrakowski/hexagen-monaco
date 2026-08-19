import React from "react";
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportScanPage } from "../ImportScanPage";

const routerReplace = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => new URLSearchParams("name=Demo"));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: routerReplace,
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/projects/new/import/scan",
  useSearchParams: () => searchParams,
  useParams: () => ({}),
}));

describe("ImportScanPage", () => {
  beforeEach(() => {
    routerReplace.mockReset();
    searchParams.set("name", "Demo");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          verdict: "pass",
          exitCode: 0,
          projectName: "Demo",
          layoutExcerpt: "contexts: {}\n",
          filesScanned: 1,
          reportMarkdown: null,
          errorMessage: null,
        }),
      }),
    );
  });

  it("shows the zip upload control and the carried project name", () => {
    render(<ImportScanPage />);
    assert.ok(screen.getByRole("heading", { name: "Scan existing project" }));
    assert.ok(screen.getByLabelText(/upload a zip/i));
    assert.match(document.body.textContent || "", /Project:\s*Demo/);
  });

  it("posts the zip to /api/projects/scan and shows a pass panel", async () => {
    const user = userEvent.setup();
    render(<ImportScanPage />);
    const input = screen.getByLabelText(/upload a zip/i) as HTMLInputElement;
    const file = new File(["PK\u0003\u0004"], "repo.zip", {
      type: "application/zip",
    });
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: /run scan/i }));

    await waitFor(() => {
      assert.ok(screen.getByText("Scan passed"));
    });
    const fetchMock = vi.mocked(fetch);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(fetchMock.mock.calls[0]?.[0], "/api/projects/scan");
  });

  it("surfaces a rejected zip (zip-slip) without spinning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "Zip contains an unsafe path and was rejected",
          reason: "zip-slip",
        }),
      }),
    );
    const user = userEvent.setup();
    render(<ImportScanPage />);
    const input = screen.getByLabelText(/upload a zip/i);
    await user.upload(
      input,
      new File(["PK"], "evil.zip", { type: "application/zip" }),
    );
    await user.click(screen.getByRole("button", { name: /run scan/i }));
    await waitFor(() => {
      assert.match(
        document.body.textContent || "",
        /unsafe path and was rejected/,
      );
    });
    assert.equal(screen.queryByText("Scanning"), null);
  });
});
