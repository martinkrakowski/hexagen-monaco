/**
 * S3 state behaviour.
 *
 * The transforms themselves are covered by `layout-draft.test.ts`; what is
 * asserted here is only what the hook adds — that the ratification gate cannot
 * be bypassed, that a new scan replaces the rows, and that a replayed draft
 * survives re-entering the screen from S4.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import type { BrownfieldLayoutDraft } from "../BrownfieldFlow/types";
import { useLayoutRatify } from "./useLayoutRatify";
import type { DetectedPackageSummary, toLayoutDraft } from "./layout-draft";

function detected(): DetectedPackageSummary[] {
  return [
    {
      root: "packages/orders",
      name: "orders",
      layers: { domain: ["src/domain"] },
    },
    {
      root: "packages/billing",
      name: "billing",
      layers: { domain: ["src/core"] },
    },
    { root: "packages/eslint-config", name: "eslint-config", layers: {} },
  ];
}

describe("useLayoutRatify", () => {
  it("starts from the detection, with unlayered packages unticked", () => {
    const { result } = renderHook(() =>
      useLayoutRatify({ packages: detected() }),
    );
    expect(result.current.rows.map((row) => row.include)).toEqual([
      true,
      true,
      false,
    ]);
    expect(result.current.validation.includedCount).toBe(2);
    expect(result.current.canRatify).toBe(true);
  });

  it("hands the flow a projected draft on ratify", () => {
    const onRatifyLayout = vi.fn();
    const { result } = renderHook(() =>
      useLayoutRatify({ packages: detected(), onRatifyLayout }),
    );

    act(() => result.current.ratify());

    expect(onRatifyLayout).toHaveBeenCalledTimes(1);
    const draft = onRatifyLayout.mock.calls[0][0] as BrownfieldLayoutDraft;
    expect(draft.contexts.map((context) => context.contextName)).toEqual([
      "orders",
      "billing",
    ]);
  });

  it("refuses to ratify an empty layout even if the caller asks directly", () => {
    // The footer disables Continue, but a keyboard Enter or a future caller
    // must not be able to hand the flow a layout that checks nothing.
    const onRatifyLayout = vi.fn();
    const { result } = renderHook(() =>
      useLayoutRatify({ packages: detected(), onRatifyLayout }),
    );

    act(() => {
      result.current.toggleInclude("packages/orders", false);
    });
    act(() => {
      result.current.toggleInclude("packages/billing", false);
    });

    expect(result.current.canRatify).toBe(false);
    act(() => result.current.ratify());
    expect(onRatifyLayout).not.toHaveBeenCalled();
  });

  it("refuses to ratify a colliding rename", () => {
    const onRatifyLayout = vi.fn();
    const { result } = renderHook(() =>
      useLayoutRatify({ packages: detected(), onRatifyLayout }),
    );

    act(() => {
      result.current.rename("packages/billing", "orders");
    });

    expect(result.current.canRatify).toBe(false);
    act(() => result.current.ratify());
    expect(onRatifyLayout).not.toHaveBeenCalled();
  });

  it("reports the in-progress draft after every edit", () => {
    const onDraftChange = vi.fn();
    const { result } = renderHook(() =>
      useLayoutRatify({ packages: detected(), onDraftChange }),
    );

    act(() => {
      result.current.rename("packages/billing", "invoicing");
    });

    expect(onDraftChange).toHaveBeenCalledTimes(1);
    const draft = onDraftChange.mock.calls[0][0] as BrownfieldLayoutDraft;
    expect(draft.contexts[1].contextName).toBe("invoicing");
  });

  it("stays silent when an edit changes nothing", () => {
    const onDraftChange = vi.fn();
    const { result } = renderHook(() =>
      useLayoutRatify({ packages: detected(), onDraftChange }),
    );

    act(() => {
      result.current.toggleInclude("packages/orders", true);
    });

    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("replays a previously ratified draft over the detection", () => {
    const ratifiedDraft: BrownfieldLayoutDraft = {
      contexts: [
        {
          packageRoot: "packages/eslint-config",
          contextName: "tooling",
          layerDirectories: { infrastructure: ["src"] },
        },
      ],
    };
    const { result } = renderHook(() =>
      useLayoutRatify({ packages: detected(), ratifiedDraft }),
    );

    expect(result.current.rows.map((row) => row.include)).toEqual([
      false,
      false,
      true,
    ]);
    expect(result.current.rows[2].contextName).toBe("tooling");
  });

  it("replaces the rows when a new scan arrives", () => {
    const first = detected();
    const { result, rerender } = renderHook(
      ({ packages }: { packages: DetectedPackageSummary[] }) =>
        useLayoutRatify({ packages }),
      { initialProps: { packages: first } },
    );

    act(() => {
      result.current.rename("packages/orders", "ordering");
    });
    expect(result.current.rows[0].contextName).toBe("ordering");

    rerender({
      packages: [
        { root: "apps/web", name: "web", layers: { presentation: ["src/ui"] } },
      ],
    });

    expect(result.current.rows.map((row) => row.packageRoot)).toEqual([
      "apps/web",
    ]);
  });

  it("keeps the user's edits when the same packages array re-renders", () => {
    const packages = detected();
    const { result, rerender } = renderHook(
      (props: { packages: DetectedPackageSummary[] }) =>
        useLayoutRatify({ packages: props.packages }),
      { initialProps: { packages } },
    );

    act(() => {
      result.current.rename("packages/orders", "ordering");
    });
    rerender({ packages });

    expect(result.current.rows[0].contextName).toBe("ordering");
  });

  it("survives a caller that passes a fresh packages array every render", () => {
    // The natural way to call this is with an inline literal, which hands the
    // hook a new array identity on EVERY render. Keying the rebuild on the
    // array reference made that an infinite loop -- React aborts with "Too
    // many re-renders", so the screen crashes rather than degrades.
    const onRatifyLayout = vi.fn();
    const { result, rerender } = renderHook(() =>
      useLayoutRatify({ packages: detected(), onRatifyLayout }),
    );
    const before = result.current.rows.length;
    rerender();
    rerender();
    expect(result.current.rows.length).toBe(before);
  });

  it("keeps edits when a re-scan finds the same packages", () => {
    // Content keying is also better behaviour than reference keying was:
    // discarding somebody's ratification because an identical array arrived
    // with a new identity was never the intent.
    const onRatifyLayout = vi.fn();
    const { result, rerender } = renderHook(() =>
      useLayoutRatify({ packages: detected(), onRatifyLayout }),
    );
    const target = result.current.rows[0].packageRoot;
    act(() => result.current.rename(target, "renamed-context"));
    expect(
      result.current.rows.find((r) => r.packageRoot === target)?.contextName,
    ).toBe("renamed-context");

    rerender();

    expect(
      result.current.rows.find((r) => r.packageRoot === target)?.contextName,
    ).toBe("renamed-context");
  });

  it("replays a draft that arrives after hydration", () => {
    // BF-3.4's useBrownfieldDraft CANNOT return a restored draft on the first
    // render -- it hands useSyncExternalStore a null server snapshot so the
    // server and hydration renders agree, then flips once. So the draft is
    // reliably null at mount and arrives a render later with `packages`
    // unchanged, which the detection signature cannot see. Without this the
    // user's saved ratification was discarded every single time.
    const onRatifyLayout = vi.fn();
    const packages = detected();
    let draft: ReturnType<typeof toLayoutDraft> | null = null;
    const { result, rerender } = renderHook(() =>
      useLayoutRatify({ packages, ratifiedDraft: draft, onRatifyLayout }),
    );

    const target = result.current.rows[0].packageRoot;
    expect(
      result.current.rows.find((r) => r.packageRoot === target)?.contextName,
    ).not.toBe("restored-name");

    draft = {
      contexts: [
        {
          packageRoot: target,
          contextName: "restored-name",
          layerDirectories: { domain: ["src/domain"] },
        },
      ],
    } as ReturnType<typeof toLayoutDraft>;
    rerender();

    expect(
      result.current.rows.find((r) => r.packageRoot === target)?.contextName,
    ).toBe("restored-name");
  });
});
