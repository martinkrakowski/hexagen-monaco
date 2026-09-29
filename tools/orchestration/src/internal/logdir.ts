/** The environment variables the event writer's own resolution reads, in the order it reads them. */
export interface LogDirEnv {
  readonly LOGDIR?: string;
  readonly HOME?: string;
  readonly WAVE_LOG_ROOT?: string;
}

/**
 * The two overlay values the default log root depends on, as the config loader
 * resolves them: `repo` (`owner/name`) and an explicit `waveLogDir`.
 *
 * A-18: the source's default root was `$HOME/.waves`, a SHARED directory.
 * campaign-foundry's status server scans it and joins PRs against
 * campaign-foundry's own repo, so a wave belonging to any other repo written
 * there shows false "no PR" flags. The root is therefore per-repo:
 * `$HOME/.waves-<name>`, where `<name>` is the name half of `repo`, unless the
 * project configured `waveLogDir` outright.
 */
export interface LogDirConfig {
  /** `owner/name`, as `config.yaml.repo` records it. */
  readonly repo?: string;
  /** `config.yaml.waveLogDir`, if the project set one. `$HOME` and `~` expand. */
  readonly waveLogDir?: string;
}

/** The name half of `owner/name` — the suffix in `.waves-<name>`. */
function repoName(repo: string | undefined): string {
  const name = repo === undefined ? "" : repo.slice(repo.lastIndexOf("/") + 1);
  if (name === "") {
    // Fail closed. The only alternative is falling back to the shared
    // `~/.waves` root, which is the thing A-18 exists to stop this reading.
    throw new Error(
      "cannot resolve a wave log root: no repository name. Set `repo` in " +
        ".agents/orchestration/config.yaml, or set WAVE_LOG_ROOT or LOGDIR.",
    );
  }
  return name;
}

/** Expand a leading `~`, plus `$HOME` and `${HOME}`, so a config may name the home directory. */
function expandHome(value: string, home: string): string {
  return value
    .replace(/^~(?=\/|$)/, home)
    .replace(/\$\{HOME\}/g, home)
    .replace(/\$HOME\b/g, home);
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/**
 * The default log directory for a wave id, used when neither `$LOGDIR` nor a
 * `--logdir` flag names one.
 *
 * `$LOGDIR` is read FIRST and wins outright, with no `exists` check at all: an
 * env var that is set and non-empty names the directory, full stop. This is the
 * source's own ordering, and the merge and pre-PR checks have to agree with the
 * event writer bit for bit — the very directory a lane's events were appended
 * to.
 *
 * Only once `$LOGDIR` is unset or empty is the ROOT chosen, in this order:
 *
 * 1. `$WAVE_LOG_ROOT` — the operator's standing override, unchanged from the source.
 * 2. `config.yaml.waveLogDir` — the project's own setting.
 * 3. `$HOME/.waves-<name>`, where `<name>` is the name half of `repo`.
 *
 * Every one of these is POSIX `${VAR:-word}` semantics — unset OR empty
 * substitutes the fallback, not `??`'s unset-or-null-only rule — so an exported
 * `HOME=""` or `WAVE_LOG_ROOT=""` falls back exactly as the source does, rather
 * than routing a caller at `//.waves/…`. An unset `$HOME` falls back to `/tmp`,
 * making root 3 `/tmp/.waves-<name>`.
 *
 * The source's shared `~/.waves` is absent from this list and unreachable from
 * all three (A-18).
 *
 * The candidate search that follows is the source's, unchanged: in order
 * `<root>/wave-<wave>`, `<root>/wave<wave>`, `<root>/<wave>` (only when `wave`
 * already starts with `wave`), then the same three under `/tmp` — the FIRST
 * that exists wins. When none exists, the default is `<root>/<wave>` when `wave`
 * starts with `wave`, otherwise `<root>/wave-<wave>`; `/tmp` is only ever a
 * fallback for a directory that is already there, never a default of its own.
 */
export function defaultLogDir(
  wave: string,
  env: LogDirEnv,
  exists: (path: string) => boolean,
  config: LogDirConfig = {},
): string {
  if (nonEmpty(env.LOGDIR)) {
    return env.LOGDIR;
  }

  // `??` alone triggers only on unset (null/undefined); POSIX `${VAR:-word}`
  // triggers on unset OR empty. An exported HOME="" or WAVE_LOG_ROOT="" must
  // fall back the same way, or the gate looks in a different directory from
  // the one the event writer actually wrote to.
  const home = nonEmpty(env.HOME) ? env.HOME : "/tmp";
  const root = nonEmpty(env.WAVE_LOG_ROOT)
    ? env.WAVE_LOG_ROOT
    : nonEmpty(config.waveLogDir)
      ? expandHome(config.waveLogDir, home)
      : `${home}/.waves-${repoName(config.repo)}`;
  const startsWithWave = wave.startsWith("wave");

  const candidates = [
    `${root}/wave-${wave}`,
    `${root}/wave${wave}`,
    ...(startsWithWave ? [`${root}/${wave}`] : []),
    `/tmp/wave-${wave}`,
    `/tmp/wave${wave}`,
    ...(startsWithWave ? [`/tmp/${wave}`] : []),
  ];

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }

  return startsWithWave ? `${root}/${wave}` : `${root}/wave-${wave}`;
}
