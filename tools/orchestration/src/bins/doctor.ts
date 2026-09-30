#!/usr/bin/env node
/**
 * `hexagen-orchestration-doctor` — the bin.
 *
 * Supplies the real filesystem, the real PATH and the real network probe; the
 * checks themselves are in `../doctor/doctor.ts`.
 */
import { execFile } from "node:child_process";
import { hasCommand, probeHttp } from "../internal/capabilities.js";
import { isFile } from "../internal/fs-probe.js";
import { loadConfigFor } from "../internal/project.js";
import { formatReport, runDoctor } from "../doctor/doctor.js";

const { root, config, present, problems } = await loadConfigFor();

/** `git worktree` succeeding is not the same as `git` existing. */
const supportsWorktrees = (): Promise<boolean> =>
  new Promise((resolve) => {
    execFile("git", ["worktree", "list"], { cwd: root }, (error) =>
      resolve(error === null),
    );
  });

const { findings, exitCode } = await runDoctor(config, problems, present, {
  exists: (path) => isFile(`${root}/${path}`),
  hasCommand,
  supportsWorktrees,
  httpReachable: probeHttp,
});

const text = formatReport(findings, config);
if (findings.some((f) => f.severity === "fail")) console.error(text);
else console.log(text);

process.exitCode = exitCode;
