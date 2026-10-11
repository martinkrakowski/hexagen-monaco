# Proposal: a CLI command that removes an installed template

**Date:** 2026-10-10
**Status:** Decided by the owner on 2026-10-11. The contract is the section "The decided contract" below.
Where the proposal's text further down disagrees with that section, the section wins; each such place
is marked "Decided:". No code written yet.
**Origin:** fleet inbox item `hx-cli-remove-command` (owner answer 2026-10-10: write a short proposal first).
**Relates to:** `docs/planning/2026-09-29_orchestration-template.md` (add-ons are "upgraded by version bump").

Every statement below that cites `path:line` was read in this checkout. A statement marked "not verified"
was not confirmed in the code.

## The decided contract (owner, 2026-10-11)

The owner answered the ten questions at the end of this document, numbered as they are there. His
words, as recorded in the fleet's `policy.md` (entry "2026-10-11 (early): the owner answers the ten
questions of hexagen-monaco #816"):

> 1. build recommended version / 2. yrs on all counts / 3. yes / 4. yes override / 5. fix clean up and
>    garbage collect correctly / 6. yes / 7. yes / 8. ask to install deps / 9. yes / 10. recommended defaults

Three answers were asked back the same turn (2, 5 and 8) and he settled them the same hour. They are
recorded in the same entry in the fleet session's words, not as a quotation of his:

> 2: one name, `hexagen remove`. 5: the command cleans up fully (everything the template owns,
> including folders it leaves empty and stale registry records); files kept on purpose are listed; the
> exit code is 0 whenever the removal itself worked, so there is NO exit code 2 in the contract. 8: when
> another installed template requires the one being removed, the command refuses and names it; `--force`
> overrides.

**The contract.**

| Part                 | Decided                                                                                                                                                                   | Question |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Build it             | Yes: the smallest first version                                                                                                                                           | 1        |
| Name                 | `hexagen remove <template>`. One name, no alias                                                                                                                           | 2        |
| Deleting files       | It deletes a recorded file whose current hash still equals the recorded hash                                                                                              | 3        |
| `--keep-files`       | Removes the registry entry only; deletes no file                                                                                                                          | 3        |
| `--dry-run`          | Prints the plan and changes nothing                                                                                                                                       | 1        |
| `--force`            | In the FIRST version. It means both: skip the prompt, AND override the refusals (another installed template requires this one; a file was changed, which is then deleted) | 4, 8     |
| Shared files         | Kept and listed                                                                                                                                                           | 6        |
| Changed files        | Kept and listed; never deleted without `--force`                                                                                                                          | 6        |
| Clean-up             | Full: everything the template owns, including the folders the removal leaves empty and stale registry records. Files kept on purpose are listed                           | 5        |
| Exit codes           | 0 whenever the removal itself worked (also when files were kept and listed). 1 on a refusal or an error. There is NO exit code 2                                          | 5        |
| Dependents           | When another installed template requires the one being removed: refuse and name it, unless `--force`                                                                      | 8        |
| Monorepo             | It acts on the single registry root only, and prints a note about other packages                                                                                          | 9        |
| `AddTemplateUseCase` | A re-add merges the earlier file records instead of replacing them. Its own change, FIRST, because it changes what every consumer's registry holds                        | 7        |
| Approval             | He approves the contract in this document before the command's second lane starts. The pull request that wrote this section is that approval point                        | 10       |

**Where this differs from what the proposal recommended.**

- **`--force` (question 4).** The proposal recommended leaving `--force` out of the first version and
  later splitting it into `--yes` (the prompt) and `--force` (the overrides). The owner chose AGAINST
  that: one flag, in the first version, with both meanings. There is no `--yes`.
- **Exit code 2 (question 5).** The proposal recommended a code 2 for "removed, but files were left".
  The owner chose 0 and 1 only.
- **Clean-up (question 5).** The proposal's first version left empty folders and other clean-up to the
  user as a printed list. The owner chose full clean-up by the command.
- **One template per call (question 2).** The proposal's synopsis allowed several ids. The decided
  form is `hexagen remove <template>`: one.

**Read from the decision, and stated here so that the lanes do not guess.** These follow from his
answers together with the proposal's text; he did not answer them one by one. Each is the careful
reading (delete less, refuse more):

- `--force` overrides the two refusals he named (dependents, changed files). A file that another
  installed template also records is still kept and listed under `--force`: it belongs to that template too.
- "Folders it leaves empty" are the folders that become empty because this removal deleted a file in
  them, followed upward and stopping at the first folder that is not empty and always at the project
  root. A folder that was already empty, or that holds a kept file, is not touched.
- "Stale registry records" are the template's records of files that are already gone: they leave the
  registry with the entry, and are reported as "already absent". After a removal that worked, nothing
  of the template is left in the registry, whatever was kept on disk.
- A recorded path that would leave the project root (an absolute path, or one with `..` that escapes) is
  never touched, also under `--force`: the command refuses. `--keep-files`, which touches no file, is
  the way to drop such an entry. The same holds for the registry file itself and for anything under `.git`.
  A recorded path that is no longer a plain file (a folder, a symbolic link) is kept and listed.
- An installed template whose manifest cannot be loaded (it is no longer among the bundled templates)
  may require the one being removed, and the command cannot know. It refuses and names such templates,
  unless `--force`. This is stricter than his answer 8, which names only the templates known to
  require it.
- The protected names (`.git`, the registry file) are matched in any letter case, and a path with a
  segment that ends in a dot or a space, or that holds a colon, is treated as unsafe: on Windows and
  macOS those spellings reach the same files.
- `.hexagen-update.*` conflict copies are listed and not deleted, as the proposal's table has it. He
  was not asked about them by name.
- From the proposal, unchanged: a template that is not installed prints "not installed" and exits 0; a
  dry run exits 0; a missing registry file, a missing project root, and a recorded path that leaves the
  project root are refusals (exit 1); `package.json` is never edited and the template's checklist is
  printed as the reminder.

**One-way door.** The name, the flags and the exit codes become a public contract when a package
version with the command is published. Publishing is the owner's step; nothing here publishes.

## Why

`hexagen add <id>` installs an add-on template. Nothing removes one. On 2026-10-09 a consumer project
(client-portal) had to remove a template by editing the registry file by hand. The registry file is
`.hexagen-template-config.json` in the project root (`packages/template-engine/src/domain/template-config.ts:28`).

A hand edit of that file leaves behind:

- the template's emitted files, still on disk and no longer attributed to anything;
- the template's `.hexagen-update.*` conflict copies, if an earlier add or upgrade wrote any;
- the answers other templates derived from it (see below), which silently fall back to defaults;
- no warning if another installed template `requires` the one removed.

Nothing in the code reads the removal back, so the project looks consistent while it is not (not verified
beyond the code paths cited below).

## What "installed" means today

- **Registry.** One JSON file, `{ schemaVersion: "1", templates: { <id>: record } }`
  (`template-config.ts:22-26`). Read and written by `FileSystemTemplateConfigStore`
  (`infrastructure/template-config-store.adapter.ts:13-25` load, `:59-64` save). Save is atomic: a temp file, then rename.
- **The record** (`template-config.ts:3-14`): `installedAt`, `version`, `answers`, and `generatedFiles`,
  a list of `{ path, contentHash }` with a SHA-256 of the content at generation time
  (`template-config.ts:16-20`). The paths are relative to the project root. So hashes ARE recorded
  today; nothing has to be added first to tell an unchanged file from a changed one.
- **Where the record is built.** `AddTemplateUseCase.execute` calls the emitter and stores the result
  (`application/use-cases/add-template.use-case.ts:70-85`), then saves once at the end (`:91`). It prints
  the template's checklist of manual steps (`:88`, `printChecklist` at `:124-133`). The checklist is
  text only; nothing records which `package.json` scripts or dependencies the user added from it.
- **Emission and conflicts.** The emitter (`infrastructure/file-emitter.adapter.ts:63-160`) writes each
  enabled output. If the destination exists, differs from the new content, and its current hash matches
  NO recorded hash at that path in ANY installed template (`:122-143`), it writes the new content to a
  conflict copy instead (`:146-156`) and `continue`s, so that file is not recorded (`:160` is skipped).
  The copy name comes from `conflictFilePath` (`domain/conflict-path.ts:27-32`): `rate-limit.ts` becomes
  `rate-limit.hexagen-update.ts`, `Dockerfile` becomes `Dockerfile.hexagen-update`. (The file name pattern
  is `<name>.hexagen-update<ext>`.)
- **Consequence for removal.** A file the user changed before the first add is never in `generatedFiles`.
  A file the user changed after the add is in `generatedFiles` with a stale hash. Both cases are told apart
  from an unchanged file by comparing the current SHA-256 with the recorded one.
- **Re-add replaces the record.** `config.templates[id] = record` (`add-template.use-case.ts:85`) overwrites
  the old record with only the files written in that run. Files that were skipped as conflicts on a
  `--force` re-add drop out of `generatedFiles`. A removal command cannot trust the record to list every
  file the template ever wrote (consequence inferred; not verified by a test).
- **Dependencies.** `TemplateManifest` has `requires: string[]` (templates that must be applied first)
  and `conflicts: string[]` (`domain/template-manifest.ts:24-31`). `resolveDependencies` orders installs
  and throws on a missing or conflicting template (`application/resolve-dependencies.ts:16,28,69,77-82`).
  The registry stores no reverse links. The dependents of template X are found by reading every
  installed template's manifest and its `requires` list (the manifests come from `FileSystemTemplateRegistry`,
  the same registry the `add` command uses; `commands/add/index.ts:42-43`).
- **Derived answers.** A question of type `auto` reads another installed template's answer through
  `derivedFrom` (`add-template.use-case.ts:109-114`). This is a second kind of dependency that `requires`
  does not express.
- **The CLI.** `add <ids...>` with `--force` ("Re-apply already-installed templates") and `--with-tests`
  is declared at `packages/sync/src/cli.ts:188-205`; the handler is `commands/add/index.ts:34-120`.
  `--force` there only turns off the "skip installed" check (`index.ts:48-72`). `templates list`,
  `templates info` and `validate-templates` sit beside it (`cli.ts:170-186,207-212`).
  `validate-templates` reports missing outputs and unresolved conflict files (`commands/add/validate.ts:48-56`).
- **Name clash to avoid.** `hexagen arch remove port|context` already exists and edits `manifest.yaml`
  (`packages/sync/src/commands/arch/remove.ts:1-9`, registered at `cli.ts:153`). It has its own `--force`
  meaning "skip confirmation prompts". A top-level `remove` would sit next to it.
- **Project root.** `getProjectRoot()` finds the nearest ancestor with `.architecture/manifest.yaml`
  and exits 1 if none (`commands/shared/project-root.ts:36-50,96-106`). The emitter refuses any output
  that resolves outside the root (`file-emitter.adapter.ts:~71-77`).
- **Not found.** I found no ADR about add-ons or template upgrade. ADR-0068 is about CLI bundling
  (`.architecture/decisions/ADR-0068-published-cli-bundling.md`), not templates. The orchestration plan
  says an upgrade is a version bump and wants `add --force` to leave the overlay untouched
  (`docs/planning/2026-09-29_orchestration-template.md:43,102-103`). I did not find a separate upgrade
  command in `packages/sync/src` (not verified for other packages).

## The command's contract

**Decided:** `hexagen remove <template> [--dry-run] [--force] [--keep-files]`, one template, one name.

**Name and synopsis (as proposed; the several-names form is superseded).** `hexagen remove <template> [<template> ...] [--dry-run] [--force] [--keep-files]`.
Alternatives: `hexagen templates remove <id>` (groups it with `templates list|info`, avoids the clash with
`arch remove`, but `add` is top-level so it is asymmetric); `hexagen uninstall <id>` (no clash, but a new verb).
Recommended: `hexagen remove`, with the help text saying "add-on template", mirroring `add`.

**Flags.**

- `--dry-run`: print the plan and change nothing. A real run with no flag also prints the plan first and asks
  `confirm` (the helper `add` uses, `commands/add/index.ts:48-52`); `--dry-run` is the scripting form.
- `--force`: do not prompt; also remove a template that has dependents, and delete changed files. Two meanings
  in one flag is a risk; see question 4. **Decided:** both meanings, in the first version.
- `--keep-files`: remove only the registry entry; delete no file. This is the hand edit, done safely.

**Decided:** 0 and 1 only; a removal that worked exits 0 even when files were kept. No code 2.

**Exit codes (as proposed; code 2 is superseded).** 0 removed, or nothing to do, or a dry run. 1 refused (dependents, unreadable registry, no
project root) or a failure. 2 removed with files left for the user to deal with (changed files, conflict
copies); a script can tell "clean" from "needs a look". The existing commands use only 0 and 1
(`process.exit(1)` in `commands/add/index.ts`); a code 2 would be new (not verified against the other commands).

**Output.** One line per category with counts, then the paths: registry entry, files deleted, files kept
(changed), shared files kept, conflict copies found, checklist items to undo by hand. The last line says
what the user must still do.

**Idempotency.** Removing a template that is not in `templates` prints "not installed" and exits 0. An
absent registry file is not the same as an empty one (`loadState` returns `absent`,
`template-config-store.adapter.ts:34-57`); with `absent`, the command prints that the add-on history is
unknown and exits 1 unless `--force`. A second run after a success is a no-op.

**Boundary.** Every path is resolved against the project root and rejected if it escapes it, with the same
check the emitter uses (`domain/output-path-safety.ts:16`, `file-emitter.adapter.ts:~71-77`). Registry
paths come from a file the user may have edited, so they are checked again on removal.

## What it removes

| Item                                              | Default behaviour                                                                                                             | How decided                                                                                                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry entry (`templates[id]`)                  | Removed, atomic save as `add` does                                                                                            | The record exists                                                                                                                                                                                           |
| Files the template generated, user did not change | Deleted                                                                                                                       | Current SHA-256 equals the recorded `contentHash` (hashes are recorded, `template-config.ts:16-20`)                                                                                                         |
| Files the user changed                            | Kept and listed, never deleted silently; `--force` deletes                                                                    | Current hash differs from the recorded one                                                                                                                                                                  |
| File recorded but already gone                    | Reported as "already absent"                                                                                                  | Path does not exist                                                                                                                                                                                         |
| Files shared by two templates                     | Kept and listed                                                                                                               | Two records hold the same `path`; the emitter already allows cross-template overrides (`file-emitter.adapter.ts:122-125`). Delete only if no other record lists the path (and then treat the hash as above) |
| `package.json` scripts and dependencies           | Not touched. Print the template's `checklist` (`template-manifest.ts`, `checklist` field) as the reminder                     | The record does not say which were added (see "Why"); not verified that checklists name them all                                                                                                            |
| `.hexagen-update.*` leftovers                     | Listed, not deleted, in the first version; later, deleted with `--force`                                                      | Derived with `conflictFilePath` from each recorded path, plus outputs of the manifest that were skipped as conflicts and so are not recorded                                                                |
| Empty directories                                 | Removed upward from each deleted file, stopping at the project root and at any directory that was not created by the template | A directory that was empty before the add cannot be told apart (not verified; the registry records no directories)                                                                                          |
| Answers other templates derived                   | Not changed; warn that a dependent's `auto` question used it                                                                  | `derivedFrom` lookup (`add-template.use-case.ts:109-114`)                                                                                                                                                   |

The manifest of the installed version may no longer exist (the registry is read from the CLI's bundled
templates; `commands/add/index.ts:42`). The command works from the project's own registry record for
files, and reads the manifest only for `requires` and `checklist`; if the manifest is missing it says so
and refuses dependency checks without `--force` (not verified how `FileSystemTemplateRegistry` reports a
missing id).

## Dependent templates and dependent projects

**Dependent templates.** If another installed template lists the removed one in `requires`, the command
refuses and names the dependents, with exit 1 and the exact `hexagen remove` line that would remove them in
order. `--force` removes it anyway and prints the dependents as now broken. Templates listed in `conflicts`
are irrelevant to removal. `auto` questions that read the removed template's answers are reported as a
warning, not a refusal, because they have a default fallback (`add-template.use-case.ts:112-114`).

**Dependent projects.** The registry is per project root, found by the `.architecture/manifest.yaml` walk
(`project-root.ts:36-50`). `findWorkspaceRoot` also accepts a `package.json` with `workspaces`
(`project-root.ts:67-80`), but the `add` command uses `getProjectRoot`, not the workspace root. So in a
monorepo the registry lives in one place and the command acts on that root only. It never walks into
sibling packages. Which sibling packages import code a template emitted is not recorded anywhere; the
command can only say "files under other packages that import a removed path were not checked" (a search
for importers is not verified as feasible without parsing). Recommended: print that line, do nothing else.

## What it will not do

- Edit `package.json`, lockfiles, CI workflows, `.env` files or any file not in the template's record.
- Run a package manager, git, or any command; it does not stage or commit.
- Remove anything outside the project root, or follow a symlink out of it (not verified: how the emitter
  treats symlinks; the removal must check).
- Undo what the user built on top of the template's files (imports, wiring, tests).
- Upgrade, downgrade, or re-add a template.
- Remove the generated `.hexagen-template-config.json` itself when `templates` becomes empty.

## Risks

- **A new public command is hard to withdraw.** The package is published (ADR-0068); once `remove` ships its
  name, flags and exit codes are a contract. This is the main one-way door. `--keep-files` and `--dry-run`
  should be in the first release because adding a safe flag later is easy and tightening a destructive
  default is not.
- **Deleting user work.** A hash match is the only evidence a file is unchanged. A file edited and edited
  back matches and is deleted, which is correct. A file edited by a formatter after generation does not match
  and is kept, which is safe. The risk is a wrong record: the re-add case above can leave files unrecorded
  (kept, which is safe) but a record from a different line-ending setting could mismatch (kept, safe).
  The unsafe direction would be a recorded path that the user has since replaced with unrelated content
  of the same hash; that is not realistic.
- **A half-finished removal.** Deleting files and then failing to save the registry leaves files gone and
  the entry present. Order: save the registry last, as `add` does (`add-template.use-case.ts:91`), and make
  a re-run finish the job (absent files are reported, not errors).
- **Trust in the registry file.** It is plain JSON a user may have edited; `load` does no schema check
  (`template-config-store.adapter.ts:17`). Paths must be validated on read.

## Smallest first version

**Decided:** this version is the one to build (nothing is built yet), with two changes to the list below. `--force` is in (item 4), and
the clean-up of emptied folders is done by the command, not left on the printed list (item 5).
`AddTemplateUseCase`'s merge on a re-add lands first, as its own pull request. The lane cut is made
again from the decided contract; lane 3's "later fourth lane" no longer exists.

One command, `hexagen remove <id>`, with:

1. the registry entry removed (atomic save);
2. recorded files whose current hash equals the recorded hash deleted, nothing else;
3. `--dry-run` (listing what would happen) and `--keep-files`;
4. the refusal when another installed template `requires` it, no `--force` yet (superseded: `--force` is
   in and overrides this refusal);
5. everything else printed as a list for the user to do by hand: changed files, shared files, conflict
   copies, the template's checklist, the empty-directory and `package.json` clean-up. (Superseded in part:
   the command removes the folders it leaves empty itself; the rest stays a printed list.)

Rough size: three lanes of about 45 minutes each.

- Lane 1: a pure function in `packages/template-engine` that, given a config, the manifests and the file
  contents, returns the removal plan (to delete, to keep, dependents); tests on the plan.
- Lane 2: the filesystem adapter and the `remove` command in `packages/sync/src/commands/remove/` wired in
  `cli.ts`, with `--dry-run`, `--keep-files`, exit codes, and the root-escape check; tests on a temp directory.
- Lane 3: documentation (command help, a short section in the template docs, the CLI reference) and a
  review pass. `--force`, conflict-copy deletion and empty-directory pruning are a later fourth lane.
  (Superseded: `--force` and the pruning of emptied folders are in the first version; conflict copies are
  listed, not deleted.)

## Questions for the owner

**All ten are answered** (2026-10-11); the answers are in "The decided contract" at the top. In short:
1 build it; 2 `hexagen remove`, one name; 3 yes; 4 `--force` is in with both meanings (against the
recommendation); 5 full clean-up, exit codes 0 and 1 only (against the recommendation); 6 yes; 7 yes;
8 refuse and name the dependents unless `--force`; 9 yes; 10 the recommended default.

1. Do we build it at all, or does removal stay a hand edit? Recommended: build the smallest first version;
   a real consumer needed it and the hand edit leaves files behind unrecorded.
2. Name: `hexagen remove`, `hexagen templates remove`, or `hexagen uninstall`? Recommended: `hexagen remove`,
   noting that it sits beside `arch remove`.
3. May the command delete files at all in the first version, or only drop the registry entry and print the
   file list? Recommended: delete files whose hash still matches, because the hash makes it safe; `--keep-files` opts out.
4. Should `--force` mean both "skip the prompt" and "override the dependents/delete changed files"?
   Recommended: leave `--force` out of the first version; add `--yes` for the prompt and `--force` for the overrides later.
5. Exit code 2 for "removed, but files were left": accept, or keep to 0 and 1? Recommended: accept 2, document it.
6. Shared files and changed files are kept and listed. Agree? Recommended: yes, never deleted without `--force`.
7. May we change `AddTemplateUseCase` so a re-add keeps earlier recorded files (merge, not replace,
   `add-template.use-case.ts:85`), so removal can trust the record? Recommended: yes, as a separate small
   change before or with lane 1, since it affects every consumer's registry.
8. Dependents: refuse and name them. Agree? Recommended: yes.
9. In a monorepo, act on the single registry root only and print a note about other packages. Agree? Recommended: yes.
10. Who decides the public contract (flags, exit codes) before publish, and in which release does it ship?
    Recommended: the owner approves the contract in this document before lane 2 starts.
