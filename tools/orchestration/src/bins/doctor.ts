#!/usr/bin/env node
/**
 * `hexagen-orchestration-doctor` — the bin.
 *
 * Supplies the real filesystem, the real PATH and the real process runners; the
 * checks themselves are in `../doctor/doctor.ts`. `runCheck` and `runRemote` are
 * the two ways this bin touches a lane host, and `localUserEmail` is the third
 * remote read it makes — the other two being the ssh probe and the clone's own
 * `user.email`.
 */
import { execFile } from "node:child_process";
import { hasCommand, runCheck, runRemote } from "../internal/capabilities.js";
import { isFile } from "../internal/fs-probe.js";
import { loadConfigFor } from "../internal/project.js";
import { formatReport, runDoctor } from "../doctor/doctor.js";

const { root, config, present, problems, deprecations } = await loadConfigFor();

/** `git worktree` succeeding is not the same as `git` existing. */
const supportsWorktrees = (): Promise<boolean> =>
  new Promise((resolve) => {
    execFile("git", ["worktree", "list"], { cwd: root }, (error) =>
      resolve(error === null),
    );
  });

/**
 * This repository's own `user.email`, or `undefined` when git cannot answer.
 *
 * It is a local read, not a lane-host one: it answers "would the clone's email
 * end up in a commit here", so it is about THIS repository, not about a host.
 */
const localUserEmail = (): Promise<string | undefined> =>
  new Promise((resolve) => {
    execFile("git", ["config", "user.email"], { cwd: root }, (error, stdout) =>
      resolve(error === null ? stdout.trim() || undefined : undefined),
    );
  });

const { findings, exitCode } = await runDoctor(
  config,
  problems,
  deprecations,
  present,
  {
    exists: (path) => isFile(`${root}/${path}`),
    hasCommand: (command) => hasCommand(command),
    // `dispatch[0]` only: a relative one is written relative to the repository.
    hasDispatchCommand: (command) =>
      hasCommand(command, process.env, { cwd: root }),
    supportsWorktrees,
    // From the repository root, so a relative `check` means the same thing from
    // any subdirectory.
    runCheck: (argv, timeoutMs) => runCheck(argv, timeoutMs, { cwd: root }),
    runRemote: (alias, argv, timeoutMs) =>
      runRemote(alias, argv, timeoutMs, { cwd: root }),
    localUserEmail,
    gateSlots: () => process.env.HEXAGEN_GATE_SLOTS,
  },
);

const text = formatReport(findings, config);
if (findings.some((f) => f.severity === "fail")) console.error(text);
else console.log(text);

process.exitCode = exitCode;
