---
name: sync-upstream
description: Manually merge T3 Code upstream updates into p4code main.
disable-model-invocation: true
---

# Sync upstream

Run only when the user requests an upstream sync. This is a manual procedure;
do not schedule it. Upstream is `pingdotgg/t3code`, and `origin` is the
`pierophp/p4code` fork.

Use **merge, never rebase or force-push**. The fork's worktrees and Threads
reference its branches. Preserving history keeps those references intact and
lets later merges reuse earlier conflict resolutions.

## Prepare

1. Read the applicable `AGENTS.md`. Inspect `git status --short`,
   `git branch --show-current`, and `git worktree list`. Require a clean worktree
   with no merge or rebase in progress. Leave existing work intact and stop if
   these conditions are not met.
2. Run this in the checkout that owns `main`. If `main` is checked out in another
   worktree, report its path and use that checkout only within the user's
   authorized scope. Otherwise, run `git switch main`. If local `main` is absent,
   stop and report that rather than creating it from the current ticket branch.
3. Inspect `git remote -v`. If `upstream` is missing, add it:

   ```sh
   git remote add upstream https://github.com/pingdotgg/t3code.git
   ```

   Git remotes are local repository configuration, shared by its worktrees;
   they are not committed or copied by cloning the fork. Repeat this setup in
   each fresh clone. An existing remote must identify `pingdotgg/t3code` (SSH or
   HTTPS); stop on a different repository rather than overwriting it. Leave
   `origin` pointing at the fork.

## Fetch and inspect

1. Record `git rev-parse HEAD`, then run `git fetch upstream`. Stop on a fetch
   failure; do not merge a stale tracking ref.
2. Run `git log --oneline main..upstream/main` to report the incoming commits,
   and `git diff --stat main...upstream/main` to show their changed files.
3. Run `git merge-base --is-ancestor upstream/main main`.
   - Exit 0: report "Nothing new from upstream" and stop. Leave `main`, the
     index, and working files unchanged; create no commit. Fetch may update
     remote-tracking refs.
   - Exit 1: upstream has commits to absorb; proceed to the merge.
   - Any other exit: report the error and stop.

## Merge and resolve

1. Run `git merge --no-ff --no-edit upstream/main` on `main`.
2. If it conflicts, inspect `git status` and
   `git diff --name-only --diff-filter=U`. Resolve each conflicted file by
   preserving upstream behavior and the fork's intended additions. Follow the
   fork's footprint rules and marked blocks where present. Stage only the
   resolved paths with `git add <paths>`.
3. Before completing a conflicted merge, require no unmerged paths and run
   `git diff --cached --check`. Run focused checks for affected behavior under
   the applicable repository instructions, then use `git merge --continue`.
   If a resolution is unclear, report the unresolved paths and decision needed;
   do not guess. To abandon this sync and restore the pre-merge state, run
   `git merge --abort`. Do not reset or rebase to escape a conflict.
4. After a successful merge, run `git diff --check` and the focused checks for
   changed behavior. Run the fork's footprint checker if it exists. Report any
   failed check and leave publication pending.
5. Confirm a clean `git status --short` and that
   `git merge-base --is-ancestor upstream/main main` succeeds. Report the old
   and new `main` SHAs, absorbed upstream tip, conflict resolutions, and checks.
   Push with `git push origin main` only when publication is authorized.

## List fork-local commits

After fetching upstream, the canonical command lists commits reachable from
the fork's `main` but not from upstream's `main` (including sync merge commits):

```sh
git log upstream/main..main
```
