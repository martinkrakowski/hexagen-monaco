#!/usr/bin/env node

import { parseArgs } from './config.js';
import { SyncEngine } from './sync-engine.js';

/**
 * CLI entry point for @hexagen/sync.
 * This is the ONLY file that should ever touch process.argv.
 */
async function main() {
  const flags = parseArgs(process.argv);
  const engine = new SyncEngine(flags);

  try {
    await engine.run();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown fatal error';
    flags.logger.error(`Fatal sync error: ${message}`);
    process.exit(1);
  }
}

main();
