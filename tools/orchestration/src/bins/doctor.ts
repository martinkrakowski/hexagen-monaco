#!/usr/bin/env node
/**
 * `hexagen-orchestration-doctor` — the bin.
 *
 * Supplies the real filesystem, the real PATH and the real network probe; the
 * checks themselves are in `../doctor/doctor.ts`.
 */
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { loadConfigFor } from "../internal/project.js";
import { formatReport, runDoctor } from "../doctor/doctor.js";

const { root, config, present, problems } = await loadConfigFor();

/** Whether a command is on PATH, without running it. */
const hasCommand = (command: string): Promise<boolean> =>
  new Promise((resolve) => {
    execFile("command", ["-v", command], (error) => resolve(error === null));
  });

/** `git worktree` succeeding is not the same as `git` existing. */
const supportsWorktrees = (): Promise<boolean> =>
  new Promise((resolve) => {
    execFile("git", ["worktree", "list"], { cwd: root }, (error) =>
      resolve(error === null),
    );
  });

/** A plain reachability probe. Any HTTP answer counts; only a failure is a failure. */
const httpReachable = (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    globalThis
      .fetch(url, { method: "GET", signal: controller.signal })
      .then(() => resolve(true))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer));
  });

const { findings, exitCode } = await runDoctor(config, problems, present, {
  exists: async (path) => {
    try {
      await access(`${root}/${path}`);
      return true;
    } catch {
      return false;
    }
  },
  hasCommand,
  supportsWorktrees,
  httpReachable,
});

const text = formatReport(findings, config);
if (findings.some((f) => f.severity === "fail")) console.error(text);
else console.log(text);

process.exitCode = exitCode;
