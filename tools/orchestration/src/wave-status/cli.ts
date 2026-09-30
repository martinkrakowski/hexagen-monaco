import { errorText } from "../internal/artifact.js";
import { renderStatus } from "./lib/render.js";
import type { WaveStatus } from "../internal/wave-types.js";

/**
 * `wave-status`'s two faces and the argv that chooses between them.
 *
 * The bin is the process edge: it loads the overlay, refuses an invalid one,
 * hands over the port resolver and the scan root, and calls `runCli` exactly once. Every
 * decision that can be tested without a process, a socket or a TTY lives here.
 */

const DEFAULT_WATCH_SECONDS = 10;
const PRINT_FLAG = "--print";
const WATCH_FLAG = "--watch";
const WATCH_PREFIX = "--watch=";
const ROOT_FLAG = "--root";
const ROOT_PREFIX = "--root=";

/**
 * `serve` with no arguments, `print` with `--print`. `--print` is REQUIRED for
 * the print face's own flags: a bare `--watch` or `--root` names a flag no face
 * is currently reading, and silently honouring it would run a face the operator
 * did not ask for.
 */
export type ParsedArgs =
  | { readonly face: "serve" }
  | {
      readonly face: "print";
      /** Seconds between re-collections; false means collect once and exit. */
      readonly watch: number | false;
      readonly root?: string;
    };

export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (!argv.includes(PRINT_FLAG)) {
    const stray = argv[0];
    if (stray !== undefined) {
      throw new Error(
        `unknown argument: ${JSON.stringify(stray)} — with no --print there are no arguments to give; ` +
          `--watch and --root belong to the print face`,
      );
    }
    return { face: "serve" };
  }

  let watch: number | false = false;
  let root: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === PRINT_FLAG) continue;
    if (arg === WATCH_FLAG) {
      watch = DEFAULT_WATCH_SECONDS;
    } else if (arg.startsWith(WATCH_PREFIX)) {
      const seconds = Number(arg.slice(WATCH_PREFIX.length));
      if (!Number.isInteger(seconds) || seconds < 1) {
        throw new Error(
          `invalid --watch seconds: ${JSON.stringify(arg.slice(WATCH_PREFIX.length))}`,
        );
      }
      watch = seconds;
    } else if (arg === ROOT_FLAG) {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--root requires a path");
      if (next === "" || next.startsWith("-")) {
        throw new Error(`--root requires a path, not ${JSON.stringify(next)}`);
      }
      root = next;
      i += 1;
    } else if (arg.startsWith(ROOT_PREFIX)) {
      const value = arg.slice(ROOT_PREFIX.length);
      if (value === "" || value.startsWith("-")) {
        throw new Error(`--root requires a path, not ${JSON.stringify(value)}`);
      }
      root = value;
    } else {
      throw new Error(`unknown argument: ${JSON.stringify(arg)}`);
    }
  }
  return { face: "print", watch, ...(root !== undefined ? { root } : {}) };
}

/** Everything `runCli` needs from the process, injected so tests never touch a TTY or the clock. */
export interface CliIo {
  readonly argv: readonly string[];
  /**
   * The scan root the print face uses when `--root` is absent — the
   * per-repository wave log root the bin resolved from the overlay.
   */
  readonly defaultScanRoot: string;
  /**
   * Resolves the port the server face binds, from the overlay and `PORT`. It is
   * a function so that only the serve path asks: a one-shot `--print` binds
   * nothing, so a `PORT` the file forbids must not stop it. It throws on a port
   * that is invalid or forbidden, and the serve path reports that as exit 2.
   */
  readonly port: () => number;
  readonly isTTY: boolean;
  readonly noColor: boolean;
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  readonly collect: (scanRoot: string) => Promise<WaveStatus>;
  readonly schedule: (fn: () => void, ms: number) => unknown;
  /** Binds the read-only server; injected so no test opens a socket. */
  readonly serve: (options: {
    readonly port: number;
    readonly scanRoot: string;
  }) => Promise<{ readonly url: string }>;
}

/**
 * The print face: collect once, render once, exit — or, with `--watch`,
 * re-collect on an interval until interrupted. The scan root resolves exactly as
 * the server face's does, so the two never disagree about what they are reading.
 *
 * The exit code is the answer: 0 for a completed render, 1 when the first
 * collection failed, 2 for arguments this tool does not have. A collect that fails inside `--watch` is reported and the
 * loop continues — a watching terminal is a live view, and one bad collection
 * does not end it.
 */
export async function runCli(io: CliIo): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(io.argv);
  } catch (error) {
    io.logError(errorText(error));
    return 2;
  }

  if (args.face === "serve") {
    let port: number;
    try {
      port = io.port();
    } catch (error) {
      io.logError(errorText(error));
      return 2;
    }
    const handle = await io.serve({
      port,
      scanRoot: io.defaultScanRoot,
    });
    io.log(
      `  wave-status serving ${handle.url} — read-only: it starts, kills and merges nothing.`,
    );
    return 0;
  }

  const root = args.root ?? io.defaultScanRoot;
  const color = io.isTTY && !io.noColor;
  const print = async (): Promise<void> => {
    io.log(renderStatus(await io.collect(root), { color }));
  };
  // The FIRST collection is the one the operator asked for by name, so a failure
  // here is the answer: one line naming what could not be read, and exit 1. Left
  // to escape, it was an unhandled rejection and a stack trace. (Later ticks of
  // `--watch` are different — see `tick` — because a live view outlives one bad
  // collection.)
  try {
    await print();
  } catch (error: unknown) {
    io.logError(errorText(error));
    return 1;
  }
  if (args.watch === false) return 0;
  // A self-scheduling loop: each refresh is awaited before the next is armed,
  // so a slow collection delays the interval instead of racing a new print.
  const tick = async (): Promise<void> => {
    await new Promise<void>((resolve) =>
      io.schedule(() => resolve(), (args.watch as number) * 1000),
    );
    try {
      await print();
    } catch (error: unknown) {
      io.logError(errorText(error));
    }
    void tick();
  };
  void tick();
  return 0;
}
