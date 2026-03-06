import { parseArgs } from './config.js';
import { SyncEngine } from './sync-engine.js';

/**
 * CLI entry point for @hexagen/sync.
 * This is the ONLY file that should ever touch process.argv.
 */
async function main() {
  const config = parseArgs(process.argv);

  const engine = new SyncEngine(config);

  await engine.run();
}

main().catch((err) => {
  console.error('Fatal sync error:', err.message);
  process.exit(1);
});

// ───────────────────────────────────────────────────────────────────────────────
// Barrel re-exports – required for barrel-only import rule compliance
// All external consumers (including legacy sync.ts forwarder) must use these
// ───────────────────────────────────────────────────────────────────────────────

export { parseArgs } from './config.js';
export { SyncEngine } from './sync-engine.js';
export type { SyncConfig } from './config.js';
