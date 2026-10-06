# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY-MAP.md`** at the repo root: use it to find the `GLOSSARY.md` files for contexts relevant to the task.
- **`docs/adr/`**: read system-wide ADRs that touch the area you're about to work in.
- In the relevant `apps/<context>/` or `packages/<context>/` directory, read its **`GLOSSARY.md`** and **`docs/adr/`** when present.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This repo uses a multi-context layout:

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          # system-wide decisions
├── apps/
│   └── <context>/
│       ├── GLOSSARY.md
│       └── docs/adr/                  # context-specific decisions
└── packages/
    └── <context>/
        ├── GLOSSARY.md
        └── docs/adr/                  # context-specific decisions
```

`GLOSSARY-MAP.md` points to the context glossaries that exist. Only read the glossaries and ADRs relevant to the task.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant context's `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
