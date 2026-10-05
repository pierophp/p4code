# p4code footprint discipline

When working on p4code, read this file alongside the repository's root AGENTS.md.
Before changing domain, storage, transport, or package boundaries, read
[README.md](README.md) for the fork architecture.

All p4code application logic belongs in new files under `packages/p4code-*`.
Keep this directory limited to documentation, footprint tooling, and declaration
data; it is not a workspace package.

[footprint.json](footprint.json) is the authoritative list of allowed
upstream-owned paths and the reason for each. Read it before editing an upstream
file. It covers server startup and future route composition, sidebar chrome,
and the desktop build override. Change that list only when the requested work
explicitly authorizes a new integration seam. Keep T3 Code's database schema,
migration sequence, WebSocket RPC contracts, and desktop package manifest intact.

Inside each declared upstream file, keep all p4code integration in **one
contiguous block**, including any imports or wiring. Use comments appropriate to
the surrounding language with matching delimiters:

```ts
// p4code:begin <purpose>
// Integration calls into new p4code files belong here.
// p4code:end <purpose>
```

In JSX, use `{/* p4code:begin <purpose> */}` and
`{/* p4code:end <purpose> */}`. Choose an integration shape that fits one block;
multiple scattered blocks in a file violate the rule. The lock and HTTP route
composition share the server file, so later route work must consolidate their
integration into one block. Keep behavior in new files and the block small so
upstream conflicts remain mechanical to resolve.

Before committing and after an upstream merge, run `./p4code/p4code:footprint`.
Completion requires zero undeclared upstream paths and a review confirming one
marked block per touched integration file. The command checks paths, not block
structure. Report failures rather than widening the declaration to hide them.
For requested upstream syncs, follow
[sync-upstream](../.agents/skills/sync-upstream/SKILL.md): merge, never rebase.
