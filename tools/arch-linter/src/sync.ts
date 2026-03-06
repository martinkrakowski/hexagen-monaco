// tools/arch-linter/src/sync.ts
// LEGACY FORWARDER — DEPRECATED
// The real implementation is now in @hexagen/sync (with GeneratorResult + rich summary)
// This stub exists only to let the arch-linter build pass until we delete the legacy folder.

console.warn('⚠️  Legacy arch-linter/sync.ts forwarder called (deprecated)');

export function parseArgs(args: string[] = process.argv.slice(2)) {
  return {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    forceRoot: args.includes('--force-root'),
  };
}

export class SyncEngine {
  constructor(config: any) {}
  async run() {
    console.log(
      '[legacy stub] Real SyncEngine is now in packages/sync with full GeneratorResult support'
    );
  }
}
