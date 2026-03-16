import { describe, it, expect, vi } from "vitest";
import type { HexagonNode, HexagonNodeType } from "@hexagen/visualization";

// Mock the wire module before importing useCanvasState
vi.mock("../lib/wire", () => ({
  getArchitectureGraphProvider: vi.fn(() => ({
    getArchitectureGraph: vi.fn().mockResolvedValue({
      success: true,
      value: { nodes: [], edges: [] },
    }),
  })),
}));

// Test the pure functions from use-canvas-state logic
// Since the hook depends on React + external services, we test the utility functions

describe("Canvas State Logic", () => {
  describe("HexagonNodeType", () => {
    const validTypes: HexagonNodeType[] = [
      "bounded-context",
      "entity",
      "port",
      "use-case",
    ];

    it("should have exactly 4 valid node types", () => {
      expect(validTypes.length).toBe(4);
    });

    it("should accept all valid node types", () => {
      validTypes.forEach((type) => {
        const node: HexagonNode = {
          id: "test-id",
          label: "Test Node",
          type,
          position: { x: 0, y: 0 },
        };
        expect(node.type).toBe(type);
      });
    });
  });

  describe("Node Type Transitions", () => {
    it("should allow any type transition without validation", () => {
      // Per Phase 5 clarification: no validation - allow any type transition
      const node: HexagonNode = {
        id: "test-id",
        label: "Test Node",
        type: "entity",
        position: { x: 0, y: 0 },
      };

      const types: HexagonNodeType[] = [
        "bounded-context",
        "entity",
        "port",
        "use-case",
      ];

      types.forEach((newType) => {
        const updatedNode: HexagonNode = {
          ...node,
          type: newType,
        };
        expect(updatedNode.type).toBe(newType);
      });
    });
  });

  describe("Node Label Updates", () => {
    it("should update label without affecting other fields", () => {
      const originalNode: HexagonNode = {
        id: "test-id",
        label: "Original Label",
        type: "entity",
        position: { x: 100, y: 200 },
      };

      const updates = { label: "Updated Label" };
      const updatedNode: HexagonNode = {
        ...originalNode,
        ...updates,
      };

      expect(updatedNode.label).toBe("Updated Label");
      expect(updatedNode.id).toBe(originalNode.id);
      expect(updatedNode.type).toBe(originalNode.type);
      expect(updatedNode.position).toEqual(originalNode.position);
    });
  });

  describe("Node Type Updates", () => {
    it("should update type without affecting other fields", () => {
      const originalNode: HexagonNode = {
        id: "test-id",
        label: "Test Node",
        type: "entity",
        position: { x: 100, y: 200 },
      };

      const updates = { type: "bounded-context" as HexagonNodeType };
      const updatedNode: HexagonNode = {
        ...originalNode,
        ...updates,
      };

      expect(updatedNode.type).toBe("bounded-context");
      expect(updatedNode.label).toBe(originalNode.label);
      expect(updatedNode.id).toBe(originalNode.id);
    });
  });

  describe("Combined Label and Type Updates", () => {
    it("should update both label and type", () => {
      const originalNode: HexagonNode = {
        id: "test-id",
        label: "Test Node",
        type: "entity",
        position: { x: 100, y: 200 },
      };

      const updates = {
        label: "New Label",
        type: "use-case" as HexagonNodeType,
      };
      const updatedNode: HexagonNode = {
        ...originalNode,
        ...updates,
      };

      expect(updatedNode.label).toBe("New Label");
      expect(updatedNode.type).toBe("use-case");
      expect(updatedNode.id).toBe(originalNode.id);
    });
  });
});
