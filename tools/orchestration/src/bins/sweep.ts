#!/usr/bin/env node
/**
 * `hexagen-orchestration-sweep` — not yet ported.
 *
 * Placeholder for OW-D14's canonical sixteen-bin list. The bin name and its
 * `dist/bins/sweep.js` path are FINAL and pinned here so no later lane touches
 * package.json or tsup.config.ts; the implementing lane replaces this file and
 * nothing else.
 *
 * A stub must never exit 0: a caller that shells out to a bin and reads the exit
 * code would otherwise see a completed step that never ran.
 */
process.stderr.write("hexagen-orchestration-sweep: not yet ported\n");
process.exit(2);
