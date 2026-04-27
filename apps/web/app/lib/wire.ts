// apps/web/app/lib/wire.ts
// Backward-compatible re-export barrel for dependency composition
// New code: import from wire.client or wire.server directly

/* eslint-disable no-console */
// Console is intentional here: startup diagnostics only

// Emit build info once on client bootstrap — intentional per eslint-disable above
if (typeof window !== "undefined") {
  console.info(
    `%c HexaGen v${process.env.APP_VERSION ?? "local"} · ${process.env.COMMIT_HASH ?? "dev"} `,
    "background: #1e1e2e; color: #a6e3a1; border-radius: 3px; padding: 2px 6px; font-family: monospace;",
  );
}

// Re-export all client-safe getters for backward compatibility
export * from "./wire.client.js";

// Re-export shared utilities
export {
  createWebLogger,
  createEventBus,
  createIntentBus,
  createLLMProvider,
} from "./wire.shared.js";

// Note: Server-only getters (getGenerateProject, getModifyArchitectureUseCase) are in wire.server.ts
// Import them directly: import { getGenerateProject } from "@/lib/wire.server"
