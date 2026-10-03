# Review prompt for the six kit plans

Paste everything below the line into a fresh review session. It is written to stand alone.

---

You are reviewing six planning documents for the Hexagen Field Kit in `martinkrakowski/hexagen-monaco`. Review only. Do not write code, do not edit files, do not open a PR, and do not push. Enter a git worktree before reading (no custom path). Put no session links or session identifiers in anything you write.

## What the project is

A drop-in kit for a Forward Deployed AI Engineer working on a client repo they do not control: scan what exists, compile the smallest contract, bind humans and agents to it, leave behind a CI gate and evidence. It is not a platform. Agents are untrusted input and prompt text is not a Grant. The same contract binds humans and agents; if a human can bypass the gate, the gate is theater. The CLI and the files under `.hexagen/` are the product, and the leave-behind must run without the web app. The kernel objects are Manifest, Grant, Transaction and Trace. Anything that is UI, TUI, workbench, templates, OAuth, package publishing, or a plane ontology imposed on the client is out of scope.

## The documents (in `docs/planning/`)

1. `2026-10-03_kit-01-unaccounted-mutation-check.md`
2. `2026-10-03_kit-02-baseline-ratchet.md`
3. `2026-10-03_kit-03-slice-default-deny.md`
4. `2026-10-03_kit-04-grant-lifecycle.md`
5. `2026-10-03_kit-05-evidence-pack-and-ci-leave-behind.md`
6. `2026-10-03_kit-06-trace-timeline-and-small-items.md`

Read `docs/kernel/GRANT.md` and `docs/kernel/TRACE.md` first, then `packages/sync/README.md` sections on `grant`, `slice` and `contract`.

## What to do

Use `origin/main` after `git fetch origin`. The plans were checked at `951acf1d`; if main has moved, say which claims the new commits change.

1. **Verify every "verified" claim.** Each plan has a section titled "What is on main". For each file, line number, command and behavior cited, open the file and confirm it. A line number that is off by a few lines is a minor finding; a claim about behavior that the code contradicts is a major one. List every claim you could not confirm.
2. **Check for work that already exists.** The plans were written after an earlier proposal turned out to be stale. For each plan, search the repo for anything that already does the proposed work, and for open or merged PRs that touch the same files. Report duplicates.
3. **Check scope.** For each plan, answer: which kernel object does it read, and which does it write (the answer to either may be "none", as for a read-only check)? Does any step quietly depend on a UI, a server, a database, or the web app? Does any step redesign Grant or Trace beyond what the plan labels as an owner decision? Does any step wire Grant or Trace into `mcp-server` in a way the plan does not state?
4. **Attack the designs.**
   - Plan 1: can an agent or a human satisfy the check without the change being real? What does a forged `paths` entry buy? What happens on squash merges, rebases, renames, shallow clones, and a trace written after the fact?
   - Plan 2: is the growth guard bypassable other than by the stated `--allow-growth`? Does it fail closed when git history is missing?
   - Plan 3: does a `closed` rule interact correctly with excludes, package-root targets and unresolved imports? Is a new rule kind justified over the recipe?
   - Plan 4: does `grant list` leak key material, follow a symlink out of the directory, or report a revoked grant as live at the boundary instants (expires equal is allowed, revoked equal is denied, expires after is denied)?
   - Plan 5: does the recipe fail on the first non-zero exit in every step, with the right exit code semantics? Is the key-in-CI story honest about who holds the key?
   - Plan 6: would the timeline rule reject any line that `accept_transaction` or `propose_patch` writes today? Check this against the actual writers and their tests.
5. **Check the wording.** Flag any sentence that overclaims: "verifiable governance", "tamper-proof", or "enforces" for something that only detects after the fact. The accepted wording is that a grant is signed so the accept path can refuse a tampered blob. Enforcement today covers only the seven MCP manifest tools through `hexagen_accept_transaction`, plus the propose-only patch tool. It does not cover editor agents, shell writes, or humans editing `.architecture/` by hand.
6. **Check the order and the dependencies** between plans. Is anything scheduled before the thing it needs? Is anything sequenced that does not need to be?
7. **Check the Step Zero rule** in `AGENTS.md`. Does every plan name one of the liveness proofs `AGENTS.md` accepts (a route that renders it, a test that executes it, a CLI command that reaches it, or a consumer search with at least one match), and where it relies on a test, does that test execute the new code path rather than just import it?

## Output

Lead with a one-paragraph recommendation: ship the plans as written, ship with the listed fixes, or rework. Then give findings in this order, each with the plan number, the file and line you checked, what you found, and the fix you recommend:

- **Wrong:** claims the code contradicts.
- **Duplicate:** work that already exists.
- **Out of scope:** steps that leave the kernel or depend on the workbench.
- **Design flaw:** a way the check can be bypassed or fail open.
- **Overclaim:** wording to change.
- **Unverified:** claims you could not confirm either way.
- **Minor:** line numbers, typos, formatting.

Keep each finding to a few sentences. If a plan is sound, say so in one line and move on. End with the decisions the owner must make before any plan starts, drawn from the plans' "Decision for the owner" sections (plans 1, 3, 4, 5 and 6 each have one), and your recommendation on each.
