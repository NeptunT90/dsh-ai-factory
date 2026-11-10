# Contributing to DSH AI Factory

Thanks for your interest. This project is a host plugin for DeepSeek Harness
Desktop and is intentionally conservative about tool permissions and data
handling.

## Development setup

Requirements:

- Node.js **22.19+**
- pnpm 10+
- DSH Desktop **0.2.2-rc.1** for live verification

```powershell
pnpm install
pnpm verify
pnpm --filter @dsh-ai-factory/sync-server test
pwsh -NoProfile -File scripts/doctor.ps1
```

`pnpm verify` runs strict TypeScript, the plugin test suite and the build.

## Rules

1. Use the official DSH plugin API (`ctx.tools`, `ctx.agents`, `ctx.effect`).
   Do not patch DSH sources.
2. Do not add placeholder behavior that looks like a feature but is not
   implemented. If something is unavailable, return a precise error.
3. Every new tool or security boundary needs tests. Update `TEST_REPORT.md` for
   critical changes.
4. Never commit secrets, databases, backups, `.env` files or `node_modules`.
5. Migrations are append-only. Add a new migration version; do not edit an
   existing one.
6. Root-only tools must remain root-only, and `allowedTools` must not be widened
   implicitly.
7. Destructive operations need an explicit policy, a test and a recovery path.

## Style

- ESM, TypeScript strict, NodeNext; imports include `.js`.
- Public functions and interfaces use English JSDoc. User-facing tool messages
  are Russian.
- Time is epoch milliseconds. IDs use prefixes (`mem_`, `prj_`, `tsk_`, `agt_`).
- SQL must be parameterized.
- UTF-8 without BOM for JSON/YAML/TS. PowerShell scripts intended for Windows
  PowerShell 5.1 use UTF-8 with BOM.

## Commits

Use short imperative messages:

```text
feat(memory): add FTS5 search with project filter
fix(plugin): keep factory_status available after storage failure
test(backup): cover corrupt manifest and temp cleanup
```

Before opening a pull request:

```text
pnpm verify
```

## Pull requests

- Describe the user-visible behavior and the security impact.
- Include tests and, for live changes, the exact commands/evidence.
- Keep changes focused; large refactors should be discussed first.
- Never include a real token, credential, personal database or backup archive.

## Security

Do not open a public issue with a vulnerability or secret. Follow
[SECURITY.md](SECURITY.md).
