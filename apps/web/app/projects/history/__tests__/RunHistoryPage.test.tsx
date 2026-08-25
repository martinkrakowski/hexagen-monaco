import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RunHistoryPage } from "../RunHistoryPage";

vi.mock("@/ProjectsShell", () => ({
  ProjectsShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const ORG = "org-acme";

function runsPayload(label: string) {
  return {
    events: [
      {
        id: `evt-${label}`,
        label,
        model: "gpt-4o",
        durationMs: 1,
        retryCount: 0,
        inputTokens: 1,
        outputTokens: 1,
        costCents: 1,
      },
    ],
    trend: [],
  };
}

/** Records every URL the page fetches, answering by path. */
function stubFetch(): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const body = url.startsWith("/api/orgs")
        ? { orgs: [{ id: ORG, slug: "acme", name: "Acme", role: "member" }] }
        : runsPayload(
            url.includes("tenantId") ? "Org stage" : "Personal stage",
          );
      return {
        ok: true,
        json: async () => body,
      } as unknown as Response;
    }),
  );
  return calls;
}

describe("RunHistoryPage — tenant switcher (H1.5)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("switching tenant refetches that tenant's history", async () => {
    const calls = stubFetch();
    render(<RunHistoryPage />);

    // Personal first: no tenantId on the runs call.
    await waitFor(() => assert.ok(screen.getByText("Personal stage")));
    assert.ok(
      calls.some((u) => u === "/api/runs"),
      `expected a personal runs fetch, got ${JSON.stringify(calls)}`,
    );
    assert.equal(
      calls.filter((u) => u.includes("tenantId")).length,
      0,
      "no tenant-scoped fetch before the switch — otherwise the assertion below is meaningless",
    );

    // The selector only appears once the org list arrives.
    const select = await screen.findByLabelText("History for");
    fireEvent.change(select, { target: { value: ORG } });

    await waitFor(() => assert.ok(screen.getByText("Org stage")));
    assert.ok(
      calls.some((u) => u === `/api/runs?tenantId=${ORG}`),
      `expected a tenant-scoped refetch, got ${JSON.stringify(calls)}`,
    );
  });

  it("without orgs there is no selector, and personal history still loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.startsWith("/api/orgs")) {
          return { ok: false } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => runsPayload("Personal stage"),
        } as unknown as Response;
      }),
    );

    render(<RunHistoryPage />);
    await waitFor(() => assert.ok(screen.getByText("Personal stage")));
    assert.equal(
      screen.queryByLabelText("History for"),
      null,
      "no tenants means no switcher",
    );
  });
});
