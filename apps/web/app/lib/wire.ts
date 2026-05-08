// apps/web/app/lib/wire.ts
// Backward-compatible re-export barrel for dependency composition
// Server code MUST import from wire.server or wire.shared directly.
// This barrel re-exports wire.client, which constructs browser-only adapters
// at module load time — importing it server-side causes SSR failures.

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
export * from "./wire.client";

// Re-export shared utilities
export {
  createWebLogger,
  createEventBus,
  createIntentBus,
  createLLMProvider,
} from "./wire.shared";

// Note: Server-only getters (getGenerateProject, getModifyArchitectureUseCase) are in wire.server.ts
// Import them directly: import { getGenerateProject } from "@/lib/wire.server"
