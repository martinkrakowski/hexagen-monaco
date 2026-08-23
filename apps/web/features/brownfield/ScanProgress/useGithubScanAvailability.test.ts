import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  GITHUB_SCAN_ENDPOINT,
  useGithubScanAvailability,
} from "./useGithubScanAvailability";

/**
 * The probe on its own, now that two screens depend on it: the Tier-B scan
 * screen and the tier picker that leads to it. `useGithubScan.test.ts` still
 * covers it through the transport; this file pins the contract the picker
 * relies on directly, so a change made for one screen cannot quietly redefine
 * the answer the other renders.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(status: number): void {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
  } as unknown as Response);
}

describe("useGithubScanAvailability", () => {
  it("starts in `checking` and probes with a GET", () => {
    respond(405);
    const { result } = renderHook(() => useGithubScanAvailability());

    expect(result.current.availability).toBe("checking");
    expect(fetchMock).toHaveBeenCalledWith(
      GITHUB_SCAN_ENDPOINT,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reads the route's 405 as `available`", async () => {
    respond(405);
    const { result } = renderHook(() => useGithubScanAvailability());
    await waitFor(() => expect(result.current.availability).toBe("available"));
  });

  it("reads a 404 as the kill switch, not as a failure", async () => {
    respond(404);
    const { result } = renderHook(() => useGithubScanAvailability());
    await waitFor(() =>
      expect(result.current.availability).toBe("not-enabled"),
    );
  });

  it("leaves an unexpected status `unknown` rather than guessing", async () => {
    // A proxy that rewrites errors must not be able to hide a working feature
    // behind a "not available" screen.
    respond(502);
    const { result } = renderHook(() => useGithubScanAvailability());
    await waitFor(() => expect(result.current.availability).toBe("unknown"));
  });

  it("leaves a thrown probe `unknown`", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useGithubScanAvailability());
    await waitFor(() => expect(result.current.availability).toBe("unknown"));
  });

  it("lets a caller's own 404 overrule an earlier `available`", async () => {
    // The switch can be turned off between the probe and a later POST. The
    // POST's answer is the newer fact.
    respond(405);
    const { result } = renderHook(() => useGithubScanAvailability());
    await waitFor(() => expect(result.current.availability).toBe("available"));

    act(() => {
      result.current.markNotEnabled();
    });
    expect(result.current.availability).toBe("not-enabled");
  });

  it("probes once per mount, not once per render", async () => {
    respond(405);
    const { result, rerender } = renderHook(() => useGithubScanAvailability());
    await waitFor(() => expect(result.current.availability).toBe("available"));
    rerender();
    rerender();
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  // Raised in review on #619: the probe's `cancelled` flag guards UNMOUNT, not
  // a state transition, so a GET resolving AFTER the POST proved the endpoint
  // off would overwrite `not-enabled` with `available` -- offering a tier the
  // server had just refused. The public API was one-way; the effect was not.
  it("never promotes back to available after the POST proved it off", async () => {
    let resolveGet: ((r: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveGet = resolve;
          }),
      ),
    );

    const { result } = renderHook(() => useGithubScanAvailability());
    expect(result.current.availability).toBe("checking");

    // The POST comes back first and latches the state down.
    act(() => result.current.markNotEnabled());
    expect(result.current.availability).toBe("not-enabled");

    // The still-in-flight GET now answers 405 ("endpoint is on").
    await act(async () => {
      resolveGet?.({ status: 405, ok: false } as Response);
      await Promise.resolve();
    });

    expect(result.current.availability).toBe("not-enabled");
  });
});
