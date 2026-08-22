/**
 * S7 request behaviour.
 *
 * The hook's whole job is to reach BF-6.1's `/api/projects/install-gate` and
 * put the bytes it returns into the user's hands, so the assertions that matter
 * are: the right endpoint, the route's own wire vocabulary, and a phase that
 * never strands the user on a spinner.
 *
 * `downloadBlob` is mocked because jsdom implements neither `URL.createObjectURL`
 * nor a real anchor download — the module under test is the caller, not the
 * saver.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import type { BrownfieldGateInstallMode } from "../BrownfieldFlow/types";
import { useGateInstall } from "./useGateInstall";
import { INSTALL_GATE_ENDPOINT } from "./gate-bundle-manifest";

// `vi.hoisted` (the house idiom — see app/contexts/__tests__/ZipExportContext
// .test.tsx) because vi.mock factories run before the module body: a plain
// `const` declared here would still be in its temporal dead zone.
const harness = vi.hoisted(() => ({ downloadBlob: vi.fn() }));

// The blob/anchor plumbing is DOM detail, not the policy under test — and
// jsdom implements neither URL.createObjectURL nor a real anchor download.
vi.mock("@/lib/download-blob", () => ({
  downloadBlob: harness.downloadBlob,
}));

const downloadBlob = harness.downloadBlob;

/** Minimal stand-in for the Response shape the hook actually reads. */
function zipResponse() {
  return {
    ok: true,
    status: 200,
    blob: () => Promise.resolve(new Blob(["PK"], { type: "application/zip" })),
    json: () => Promise.reject(new Error("not json")),
  };
}

function errorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    blob: () => Promise.reject(new Error("no blob")),
    json: () => Promise.resolve(body),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  downloadBlob.mockReset();
  downloadBlob.mockReturnValue({ success: true });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(
  scanId = "scan-42",
  onDelivered?: (mode: BrownfieldGateInstallMode) => void,
) {
  return renderHook(() => useGateInstall({ scanId, onDelivered }));
}

describe("useGateInstall — the happy path", () => {
  it("starts idle on the zip mode, which is the only one available", () => {
    const { result } = setup();
    expect(result.current.phase).toBe("idle");
    expect(result.current.mode).toBe("download-zip");
    expect(result.current.message).toBeNull();
  });

  it("posts the scan id and the route's own mode vocabulary", async () => {
    fetchMock.mockResolvedValue(zipResponse());
    const { result } = setup("scan-42");

    await act(async () => {
      await result.current.install();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(INSTALL_GATE_ENDPOINT);
    expect(init.method).toBe("POST");
    // "zip", not "download-zip": the flow union and the wire contract are
    // different vocabularies and GATE_INSTALL_ROUTE_MODE is the only bridge.
    expect(JSON.parse(String(init.body))).toEqual({
      scanId: "scan-42",
      mode: "zip",
    });
  });

  it("hands the response blob to the browser under the route's filename", async () => {
    fetchMock.mockResolvedValue(zipResponse());
    const { result } = setup("scan-42");

    await act(async () => {
      await result.current.install();
    });

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [, filename] = downloadBlob.mock.calls[0] as [Blob, string];
    expect(filename).toBe("hexagen-gate-scan-42.zip");
    expect(result.current.phase).toBe("delivered");
    expect(result.current.fileName).toBe("hexagen-gate-scan-42.zip");
  });

  it("notifies the host exactly once, after the bytes are delivered", async () => {
    const onDelivered = vi.fn();
    fetchMock.mockResolvedValue(zipResponse());
    const { result } = setup("scan-42", onDelivered);

    await act(async () => {
      await result.current.install();
    });

    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledWith("download-zip");
  });
});

describe("useGateInstall — failure", () => {
  it("prefers the route's own error sentence", async () => {
    fetchMock.mockResolvedValue(
      errorResponse(500, { error: "Could not build the gate bundle" }),
    );
    const { result } = setup();

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.phase).toBe("failed");
    expect(result.current.message).toBe("Could not build the gate bundle");
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("carries the 501 explanation through verbatim", async () => {
    // The route's not-implemented sentence tells the consultant what to do
    // instead; replacing it with a house string would lose that.
    const explanation =
      "Opening a pull request is not available yet. Download the zip and apply it inside your own review process.";
    fetchMock.mockResolvedValue(
      errorResponse(501, {
        error: explanation,
        reason: "mode-not-implemented",
      }),
    );
    const { result } = setup();

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.message).toBe(explanation);
  });

  it("falls back to a house message when the body is not the expected shape", async () => {
    fetchMock.mockResolvedValue(errorResponse(413, { nope: true }));
    const { result } = setup();

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.phase).toBe("failed");
    expect(result.current.message).toMatch(/could not be built/i);
  });

  it("distinguishes an unreachable service from a rejected request", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = setup();

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.phase).toBe("failed");
    expect(result.current.message).toMatch(/could not reach/i);
  });

  it("reports a browser that refuses the save rather than claiming success", async () => {
    fetchMock.mockResolvedValue(zipResponse());
    downloadBlob.mockReturnValue({
      success: false,
      error: new Error("blocked"),
    });
    const { result } = setup();

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.phase).toBe("failed");
    expect(result.current.message).toMatch(/would not save it/i);
  });

  it("refuses a scan id the route would reject, without spending a request", async () => {
    const { result } = setup("../etc/passwd");

    await act(async () => {
      await result.current.install();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("failed");
  });
});

describe("useGateInstall — guards", () => {
  it("collapses a double click into one request", async () => {
    let release: (value: unknown) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = setup();

    await act(async () => {
      const first = result.current.install();
      const second = result.current.install();
      release(zipResponse());
      await Promise.all([first, second]);
    });

    // Two clicks inside one React batch both see phase === "idle", so the
    // in-flight ref — not the state — is what stops the second request. Without
    // it the user gets two saved files and two hits against a 20/minute budget.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears a stale failure when the user picks a different mode", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, { error: "boom" }));
    const { result } = setup();

    await act(async () => {
      await result.current.install();
    });
    expect(result.current.phase).toBe("failed");

    act(() => {
      result.current.selectMode("open-pr");
    });

    expect(result.current.mode).toBe("open-pr");
    expect(result.current.phase).toBe("idle");
    expect(result.current.message).toBeNull();
  });

  it("reset returns a closed dialog to a clean slate", async () => {
    fetchMock.mockResolvedValue(zipResponse());
    const { result } = setup();

    await act(async () => {
      await result.current.install();
    });
    expect(result.current.phase).toBe("delivered");

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.fileName).toBeNull();
    expect(result.current.message).toBeNull();
  });
});
