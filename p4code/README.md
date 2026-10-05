# p4code

p4code is a fork of [T3 Code](https://github.com/pingdotgg/t3code) that adds a
planning layer anchored on GitHub issues. T3 Code runs agents; p4code helps decide
what to run next. [Issue #1](https://github.com/pierophp/p4code/issues/1) defines
the architecture below. These are constraints for the implementation, not a claim
that the Items feature has shipped.

## Items and Threads

An **Item** is a unit of work anchored to exactly one GitHub issue URL and scoped
to a Project. It caches the issue's title, body, state, author, and comments, plus
the last refresh time. GitHub remains the source of truth. Refresh happens when
opening an Item or on explicit request; there is no background polling or writing
to GitHub. Issue state does not infer an Item workflow state.

An Item references zero or more Threads by identifier. Starting a Thread from an
Item links it immediately; existing Threads can also be linked. Normal T3 Code
Threads remain unlinked. The reference points from Item to Thread only: T3 Code's
schema never learns about Items. Deleting an Item leaves its Threads alone, and
deleting a Thread leaves the Item with an unavailable reference that can be
replaced by a new Thread.

## Package boundaries

All feature logic belongs in new workspace packages covered by the existing
`packages/*` glob:

| Package | Responsibility |
| --- | --- |
| `packages/p4code-core` | Item domain, SQLite store, GitHub CLI adapter, service methods, HTTP routes, and MCP tools |
| `packages/p4code-contracts` | Request and response schemas shared by server and client |
| `packages/p4code-web` | React components and client data access for Items |

These boundaries follow the server, contract, and UI seams of a future plugin.
Moving the packages into a plugin should not require first untangling feature
logic from upstream. This root `p4code/` directory holds documentation, the
footprint checker, and its declaration data. It is not a workspace package and
contains no application logic.

## Transport and surfaces

Items use a dedicated HTTP route layer under the server's API, composed into the
top-level route list. Explicit refresh needs no subscription or push machinery.
HTTP also avoids editing the central WebSocket RPC registries and handler map.
HTTP routes and MCP tools decode input, call the same service methods, and map
errors; business logic stays in the service.

The initial clients are web and desktop. Items get a new file-based top-level
route, a sidebar entry, and command-palette access. Mobile, workflow states, a
Context layer, and an attention dashboard are outside the initial scope. Remote
clients reach the connected environment's HTTP API using its existing connection
and authentication paths, without hard-coded local origins.

## Data and installation

p4code owns a separate SQLite file beside T3 Code's database in the same T3 home's
`userdata` directory. One backup and restore must capture both. Items use a plain
read/write store with their own schema versioning, without T3 Code migrations or
event sourcing. Thread identifiers are plain values with no cross-database
foreign keys.

The desktop fork installs alongside T3 Code with a distinct product name and
bundle identifier supplied by a build override, rather than changes to the
upstream desktop package manifest. Both use the same T3 home and therefore the
same Projects, Threads, and settings. Only one server may hold that home at a
time: the startup lock refuses a second instance and names the locked directory.
The lock is a safety prerequisite for sharing the home, not an optional feature.

## Keeping upstream merges affordable

All p4code logic lives in new files. Each upstream-owned integration file may
contain only one contiguous p4code block, delimited by `p4code:begin` and
`p4code:end` comments. Follow [AGENTS.md](AGENTS.md) for the convention and
[footprint.json](footprint.json) for the authoritative allowed paths. The startup
lock and future route composition share `apps/server/src/server.ts`; later work
must keep them in a single block rather than scatter imports and wiring.

Run the `p4code:footprint` command from the repository root:

```sh
./p4code/p4code:footprint
```

It reports upstream-owned paths changed by committed, staged, or unstaged work,
including deletions and renames, and fails if any is undeclared. New fork-only
files do not count. Ownership means a file exists in `upstream/main`. The diff
starts at the merge-base of `HEAD` and `upstream/main`, so upstream commits not yet
merged into the fork do not create false violations. The checker enforces the
path boundary; review still enforces the single-block rule. It does not fetch or
run in CI automatically. A missing upstream ref is an error.

Upstream is `pingdotgg/t3code`, tracked by the `upstream` remote. Sync by merge,
never rebase or force-push: worktrees and Threads refer to fork branches, and
merge preserves those references and conflict resolutions. When asked to sync,
use the [manual sync skill](../.agents/skills/sync-upstream/SKILL.md), which also
runs the footprint checker. After fetching, `git log upstream/main..main` lists
fork-local commits. Extend the declaration only for an explicitly agreed seam;
a passing path check does not justify expanding upstream edits.
