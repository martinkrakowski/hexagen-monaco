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
