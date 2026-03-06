#!/usr/bin/env node

import { parseArgs, SyncEngine } from '@hexagen/sync';

async function main() {
  const config = parseArgs(process.argv);
  const engine = new SyncEngine(config);
  await engine.run();
}

main().catch((err) => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
