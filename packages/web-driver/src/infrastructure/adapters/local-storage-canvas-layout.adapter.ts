import type {
  CanvasLayoutPersistencePort,
  NodePosition,
  PersistenceError,
  PersistedCanvasLayout,
  Result,
} from "@hexagen/shared";

const CANVAS_LAYOUT_KEY_PREFIX = "hexagen-canvas-layout-";

export class LocalStorageCanvasLayoutAdapter implements CanvasLayoutPersistencePort {
  async saveCanvasLayout(
    sessionId: string,
    layout: PersistedCanvasLayout,
  ): Promise<Result<void, PersistenceError>> {
    try {
      const key = `${CANVAS_LAYOUT_KEY_PREFIX}${sessionId}`;
      localStorage.setItem(key, JSON.stringify(layout));
      return { success: true, value: undefined };
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        return {
          success: false,
          error: {
            kind: "StorageQuotaExceeded" as const,
            message: "Storage quota exceeded",
          },
        };
      }
      return {
        success: false,
        error: {
          kind: "SerializationFailed" as const,
          message: "Failed to save canvas layout",
          cause: e,
        },
      };
    }
  }

  async loadCanvasLayout(
    sessionId: string,
  ): Promise<Result<PersistedCanvasLayout | null, PersistenceError>> {
    try {
      const key = `${CANVAS_LAYOUT_KEY_PREFIX}${sessionId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return { success: true, value: null };

      const layout = JSON.parse(raw) as PersistedCanvasLayout;
      if (layout.schemaVersion !== 1) {
        return { success: true, value: null };
      }

      if (!this.validateNodePositions(layout.nodePositions)) {
        return { success: true, value: null };
      }

      return { success: true, value: layout };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "DeserializationFailed" as const,
          message: "Failed to load canvas layout",
          cause: e,
        },
      };
    }
  }

  async clearCanvasLayout(
    sessionId: string,
  ): Promise<Result<void, PersistenceError>> {
    try {
      const key = `${CANVAS_LAYOUT_KEY_PREFIX}${sessionId}`;
      localStorage.removeItem(key);
      return { success: true, value: undefined };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "Unknown" as const,
          message: "Failed to clear canvas layout",
          cause: e,
        },
      };
    }
  }

  private validateNodePositions(
    positions: unknown,
  ): positions is Record<string, NodePosition> {
    if (!positions || typeof positions !== "object") {
      return false;
    }

    const posObj = positions as Record<string, unknown>;
    for (const [, value] of Object.entries(posObj)) {
      if (
        !value ||
        typeof value !== "object" ||
        typeof (value as NodePosition).x !== "number" ||
        typeof (value as NodePosition).y !== "number"
      ) {
        return false;
      }
    }

    return true;
  }
}
