import { execFile } from "node:child_process";

/**
 * Whether a command is on PATH, without running it.
 *
 * `command` is a POSIX shell BUILTIN, and `execFile` runs no shell, so
 * `execFile("command", ...)` only works on a host that happens to ship a
 * `/usr/bin/command` shim (macOS does; Ubuntu does not). The probe therefore
 * goes through `/bin/sh`, which every POSIX host has at that path, and the
 * name travels as a positional parameter rather than being spliced into the
 * script, so a name is never interpreted as shell.
 *
 * `env` is a parameter so a test can hand it a PATH with no `command` shim in
 * it, which is what a Linux runner looks like.
 */
export function hasCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "/bin/sh",
      ["-c", 'command -v "$1"', "sh", command],
      { env },
      (error) => resolve(error === null),
    );
  });
}

/** What an HTTP reachability probe found. */
export type HttpProbe = boolean | { readonly redirect: string };

/** The probe's ceiling. Short: a configured server that needs longer is not "reachable". */
export const HTTP_PROBE_TIMEOUT_MS = 3_000;

/**
 * A plain reachability probe of the configured server (OW-D7), and nothing more.
 *
 * Any HTTP ANSWER counts as reachable; only a failure to answer is unreachable.
 * A redirect is NOT followed (`redirect: "manual"`): the URL is operator
 * config, and following a 30x would let whatever answers there send this
 * process at a host nobody configured. It is reported instead, with its target,
 * and that target is never requested. The wait is bounded by
 * `AbortSignal.timeout`.
 */
export async function probeHttp(
  url: string,
  timeoutMs: number = HTTP_PROBE_TIMEOUT_MS,
): Promise<HttpProbe> {
  try {
    const response = await globalThis.fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      return { redirect: response.headers.get("location") ?? "(no Location)" };
    }
    return true;
  } catch {
    return false;
  }
}
