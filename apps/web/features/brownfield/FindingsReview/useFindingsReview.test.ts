/**
 * S5 state behaviour.
 *
 * The transforms are covered by `baseline-draft.test.ts`; what is asserted
 * here is only what the hook adds — that the ratification gate cannot be
 * bypassed, that a new scan replaces the rows without crashing on an inline
 * literal, and that decisions restored one render late are not discarded.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import type { ScanFindings } from "@/lib/project-scan/types";
import { useFindingsReview } from "./useFindingsReview";
import type { BrownfieldBaselineDraft } from "./baseline-draft";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function collected(): ScanFindings {
  return {
    collected: true,
    fresh: [
      {
        rule: "npm-package-in-domain",
        file: "packages/orders/src/domain/order.ts",
        specifier: "zod",
        message: "npm package in domain layer",
      },
      {
        rule: "server-marker-missing",
        file: "packages/billing/src/infra/db.ts",
        specifier: "",
        message: "missing server-only marker",
      },
    ],
    baselined: [],
    stale: [],
    expired: [],
  };
}

describe("useFindingsReview", () => {
  it("starts with nothing accepted", () => {
    const { result } = renderHook(() =>
      useFindingsReview({ findings: collected(), now: NOW }),
    );
    expect(result.current.rows.every((row) => !row.baselined)).toBe(true);
    expect(result.current.validation.enforcedCount).toBe(2);
    expect(result.current.canRatify).toBe(true);
  });

  it("survives a caller that builds its findings inline on every render", () => {
    // Reference keying would reset state every render and crash React with
    // "Too many re-renders"; the content signature is what makes this safe.
    const { result, rerender } = renderHook(() =>
      useFindingsReview({ findings: collected(), now: NOW }),
    );
    act(() => {
      result.current.toggleBaselined(result.current.rows[0].key, true);
    });
    rerender();
    expect(result.current.rows[0].baselined).toBe(true);
  });

  it("rebuilds when a genuinely different scan arrives", () => {
    const { result, rerender } = renderHook(
      ({ findings }: { findings: ScanFindings }) =>
        useFindingsReview({ findings, now: NOW }),
      { initialProps: { findings: collected() } },
    );
    act(() => {
      result.current.toggleBaselined(result.current.rows[0].key, true);
    });

    const other = collected();
    rerender({
      findings: { ...other, fresh: [other.fresh[1]] } as ScanFindings,
    });

    expect(result.current.rows.length).toBe(1);
    expect(result.current.rows[0].baselined).toBe(false);
  });

  it("replays a restored review that arrives one render late", () => {
    const { result, rerender } = renderHook(
      ({ ratifiedKeys }: { ratifiedKeys: string[] | null }) =>
        useFindingsReview({ findings: collected(), ratifiedKeys, now: NOW }),
      { initialProps: { ratifiedKeys: null as string[] | null } },
    );
    const key = result.current.rows[0].key;
    expect(result.current.rows[0].baselined).toBe(false);

    rerender({ ratifiedKeys: [key] });
    expect(result.current.rows[0].baselined).toBe(true);
  });

  it("reports every edit to the draft seam as a projected baseline", () => {
    const onDraftChange = vi.fn();
    const { result } = renderHook(() =>
      useFindingsReview({ findings: collected(), onDraftChange, now: NOW }),
    );

    act(() => {
      result.current.baselineRule("npm-package-in-domain", "predates adoption");
    });

    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const draft = onDraftChange.mock.calls[0][0] as BrownfieldBaselineDraft;
    expect(draft.entries.length).toBe(1);
    expect(draft.entries[0].reason).toBe("predates adoption");
  });

  it("does not notify the draft seam for a no-op", () => {
    const onDraftChange = vi.fn();
    const { result } = renderHook(() =>
      useFindingsReview({ findings: collected(), onDraftChange, now: NOW }),
    );
    act(() => {
      // Empty reason: the pure module refuses, so nothing changed.
      result.current.baselineRule("npm-package-in-domain", "   ");
    });
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("hands the flow both the keys and the baseline payload on ratify", () => {
    const onRatifyFindings = vi.fn();
    const { result } = renderHook(() =>
      useFindingsReview({ findings: collected(), onRatifyFindings, now: NOW }),
    );

    act(() => {
      result.current.baselineRule("npm-package-in-domain", "predates adoption");
    });
    act(() => result.current.ratify());

    expect(onRatifyFindings).toHaveBeenCalledTimes(1);
    const [keys, draft] = onRatifyFindings.mock.calls[0] as [
      string[],
      BrownfieldBaselineDraft,
    ];
    expect(keys.length).toBe(1);
    expect(draft.entries[0].rule).toBe("npm-package-in-domain");
  });

  it("refuses to ratify a scan whose findings were never read", () => {
    const onRatifyFindings = vi.fn();
    for (const findings of [undefined, null]) {
      const { result } = renderHook(() =>
        useFindingsReview({ findings, onRatifyFindings, now: NOW }),
      );
      expect(result.current.canRatify).toBe(false);
      expect(result.current.unavailable).not.toBeNull();
      act(() => result.current.ratify());
      expect(onRatifyFindings).not.toHaveBeenCalled();
    }
  });

  it("refuses to ratify when the scan tried to read findings and failed", () => {
    const onRatifyFindings = vi.fn();
    const { result } = renderHook(() =>
      useFindingsReview({
        findings: {
          collected: false,
          failureReason: "hexagen-lint exited 127",
          fresh: [],
          baselined: [],
          stale: [],
          expired: [],
        },
        onRatifyFindings,
        now: NOW,
      }),
    );
    expect(result.current.counts).toBeNull();
    expect(result.current.unavailable?.description).toMatch(
      /hexagen-lint exited 127/,
    );
    act(() => result.current.ratify());
    expect(onRatifyFindings).not.toHaveBeenCalled();
  });

  it("cannot be pushed past the gate by calling ratify directly", () => {
    const onRatifyFindings = vi.fn();
    const { result } = renderHook(() =>
      useFindingsReview({ findings: collected(), onRatifyFindings, now: NOW }),
    );
    act(() => {
      // Accepted with no reason — the linter would reject the entry outright.
      result.current.toggleBaselined(result.current.rows[0].key, true);
    });
    expect(result.current.canRatify).toBe(false);
    act(() => result.current.ratify());
    expect(onRatifyFindings).not.toHaveBeenCalled();
  });
});
