import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act } from "@testing-library/react";
import type { RenderableHexagonNode } from "@hexagen/visualization";

import { useCanvasGraphMutations } from "./useCanvasGraphMutations";
import { useCanvasGraphStore } from "../stores/useCanvasGraphStore";

const node = (id: string, x: number, y: number): RenderableHexagonNode => ({
  id,
  label: id,
  type: "entity",
  position: { x, y },
});

describe("useCanvasGraphMutations", () => {
  beforeEach(() => {
    useCanvasGraphStore.getState().reset();
  });

  it("mirrors a drag stop into both the store and legacy persistence", () => {
    const persistNodePosition = vi.fn();
    useCanvasGraphStore.getState().setGraph([node("a", 0, 0)], []);

    const { result } = renderHook(() =>
      useCanvasGraphMutations({ persistNodePosition }),
    );

    act(() => {
      result.current.onNodeDragStop({
        ...node("a", 0, 0),
        position: { x: 5, y: 7 },
      });
    });

    assert.deepEqual(persistNodePosition.mock.calls, [["a", { x: 5, y: 7 }]]);
    assert.deepEqual(useCanvasGraphStore.getState().nodes[0].position, {
      x: 5,
      y: 7,
    });
  });

  it("anchors a new node on root-core and returns its id for selection", () => {
    useCanvasGraphStore
      .getState()
      .setGraph([node("other", 0, 0), node("root-core", 100, 200)], []);

    const { result } = renderHook(() =>
      useCanvasGraphMutations({ persistNodePosition: vi.fn() }),
    );

    let newId = "";
    act(() => {
      newId = result.current.onAddNode();
    });

    const { nodes } = useCanvasGraphStore.getState();
    assert.equal(nodes.length, 3);
    const added = nodes.find((n) => n.id === newId);
    assert.ok(added, "onAddNode returned an id that is not in the store");
    assert.deepEqual(added.position, { x: 320, y: 420 });
  });

  it("falls back to the first node, then to a fixed origin, when there is no root", () => {
    useCanvasGraphStore.getState().setGraph([node("only", 10, 10)], []);
    const { result } = renderHook(() =>
      useCanvasGraphMutations({ persistNodePosition: vi.fn() }),
    );

    let firstId = "";
    act(() => {
      firstId = result.current.onAddNode();
    });
    assert.deepEqual(
      useCanvasGraphStore.getState().nodes.find((n) => n.id === firstId)
        ?.position,
      { x: 230, y: 230 },
    );

    useCanvasGraphStore.getState().reset();
    let emptyId = "";
    act(() => {
      emptyId = result.current.onAddNode();
    });
    assert.deepEqual(
      useCanvasGraphStore.getState().nodes.find((n) => n.id === emptyId)
        ?.position,
      { x: 100, y: 100 },
    );
  });

  it("updates only the named node's label and type", () => {
    useCanvasGraphStore
      .getState()
      .setGraph([node("a", 0, 0), node("b", 1, 1)], []);

    const { result } = renderHook(() =>
      useCanvasGraphMutations({ persistNodePosition: vi.fn() }),
    );

    act(() => {
      result.current.onUpdateNode("b", { label: "Renamed", type: "port" });
    });

    const { nodes } = useCanvasGraphStore.getState();
    assert.deepEqual(
      nodes.map((n) => [n.id, n.label, n.type]),
      [
        ["a", "a", "entity"],
        ["b", "Renamed", "port"],
      ],
    );
  });

  /**
   * The point of the extraction (REA-004): this hook does not subscribe to the
   * store, so a layout tick — the thing the finding says "re-renders mutation
   * callers" — cannot change its result identity.
   */
  it("keeps a stable identity across unrelated store churn", () => {
    const persistNodePosition = vi.fn();
    const { result, rerender } = renderHook(() =>
      useCanvasGraphMutations({ persistNodePosition }),
    );
    const before = result.current;

    act(() => {
      useCanvasGraphStore.getState().setLayoutCalculating(true);
      useCanvasGraphStore.getState().setGraph([node("z", 0, 0)], []);
    });
    rerender();

    assert.equal(result.current, before);
  });
});
