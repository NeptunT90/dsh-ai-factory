# DSH AI Factory

**A local-first autonomous multi-agent platform for DeepSeek Harness Desktop.**

AI Factory is a real DSH host plugin. It registers its tools through the
official `ctx.tools` contract, keeps state in a local SQLite database, and
survives DSH restarts. It is designed for one operator working on one or more
local projects — not as a hosted SaaS.

- **Version:** 0.25.0 (Beta)
- **DSH target:** Desktop 0.2.2-rc.1
- **Schema:** v7
- **Tool surface:** 56 tools
- **Runtime:** Node.js 22.19+, `node:sqlite`

> Status: Phase 1 core is implemented and tested end-to-end in a live DSH
> process. The optional sync server is a separate package and is not required
> for local operation.

## Why AI Factory?

DSH gives an agent tools and a context window. AI Factory gives it durable
state, ownership boundaries and a repeatable workflow:

- a task survives a crash, restart or model failure;
- a child agent receives only the tools its profile allows;
- project memory does not leak between unrelated workspaces;
- plans can require a local runtime before any task is created;
- an operator can inspect everything through a read-only dashboard.

## Features

### Memory

A durable project memory with five kinds — `working`, `episodic`, `semantic`,
`project`, `user`. It supports deduplication, version history, soft delete,
trust/confidence, TTL, FTS5 search and project/global scopes. Secrets are
rejected before they reach memory.

### Tasks

A durable Task Engine with statuses from `NEW` to `CANCELLED`, priorities,
dependencies, leases, heartbeats, bounded retries with backoff, event history
and stale-task recovery after a crash. A completed dependency automatically
makes the next plan step `READY`.

### Scoped Allowlist

Each agent profile has an explicit `allowedTools` allowlist. `factory_dispatch`
creates the child through `ctx.agents.create` with a scoped setup and an
additional runtime guard. A child sees only its profile allowlist; host file,
shell and code tools are guarded separately. Capability availability never
grants a tool.

### Skills

Project-local `.skills/*.md` files with strict frontmatter validation, file and
size limits, and root-only management tools. A profile's instruction and its
skills are injected as system sections; the task prompt remains a user message.
Skills never change `allowedTools`.

### Capability Discovery

A static host inventory for Node, Python, Java, Docker, Git, Maven, Gradle,
.NET, Go, Rust, npm, pnpm, pip and uv. Detection is filesystem-only by default
(`capabilityProbeMode=off`); no automatic scan. `factory_capability_check` is
cache-only and returns `UNKNOWN`/`STALE` rather than silently scanning. Docker
is presence-only. Plans and tasks can declare `requiresCapabilities`, checked
before plan/task creation and again before claim/child dispatch.

### Agent Marketplace

Portable `.agents/<slug>.json` profiles. Export strips internal IDs, built-in
flags, timestamps and secrets. Import validates `allowedTools` as a subset of
the caller's tools, `accessLevel` as not higher than the caller, project skills,
and name collisions. Built-in profiles export as templates; import always
creates a new custom profile.

### Backup and restore verification

`scripts/backup.ps1` creates a consistent SQLite snapshot, manifest with table
and file hashes, and a `.tar.gz` archive. `factory_backup_verify` validates gzip
magic, manifest, tar safety, SQLite `quick_check`, schema version and table
hashes. `factory_backup_restore_test` restores a copy under the system temp
directory, reports agent/task/memory counts and always cleans up.

### Dashboard

A local read-only dashboard on `127.0.0.1` with a random session token,
HttpOnly cookie, no external assets and no mutation endpoints. It shows
Overview, Agents, Tasks, Memory, Audit, Models, Sync, Tools and Settings.

### Optional sync

A local outbox and `factory_sync` (status/push/pull) can synchronize memory to
the optional PGlite/PostgreSQL server in `server/`. The token comes only from an
environment variable. The server is not required for local operation.

## Install

### From a release tarball (recommended)

```powershell
# Install into a DSH profile; back up the profile config first.
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/install.ps1 `
  -Profile desktop `
  -Tarball .\dist\dsh-ai-factory-1.0.0.tgz
```

### From source

```powershell
pnpm install
pnpm verify
pnpm --filter dsh-ai-factory build
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/install.ps1 -Profile desktop -SkipBuild
```

Then restart DSH Desktop, or reload the profile bundle. Verify readiness with:

```text
factory_status
```

Expected fields: `status: ready`, `driver: node:sqlite`, `schemaVersion: 7`,
`agents: 7` built-in profiles.

## Configuration

All options have safe defaults. The most important ones:

| Option | Default | Purpose |
|---|---|---|
| `dataDir` | `~/.dsh/ai-factory` | SQLite and local data directory |
| `allowGlobalMemory` | `true` | Allow global user memory |
| `projectIdOverride` | `""` | Pin the current project |
| `autoWorkflowEnabled` | `false` | Autonomous bounded workflow |
| `capabilityScanEnabled` | `false` | No automatic capability scans |
| `capabilityProbeMode` | `off` | Filesystem-only detection |
| `syncTokenEnv` | `DSH_AI_FACTORY_SYNC_TOKEN` | Sync token env var name |

There is no API key in the config. Never put a token in a JSON config,
`.agents` profile or memory entry.

## Security model

- Scoped `allowedTools` are enforced, not advisory.
- Capability availability is not permission.
- Root-only management tools: skills, capability scan, agent marketplace,
  backup verification/restore and other security-sensitive operations.
- Secrets are detected and rejected by memory, agent export and backup tooling.
- `.agents/`, `.skills/`, databases, backups and local data are gitignored.
- Dashboard is loopback-only and read-only.
- See [SECURITY.md](SECURITY.md) for the full model and reporting process.

## Architecture

```text
DSH Desktop
  └─ Cordis host plugin (ctx.tools / ctx.agents / ctx.effect)
       ├─ Memory Engine        SQLite + FTS5
       ├─ Agent Registry       profiles + allowlists
       ├─ Task Engine          leases, retries, recovery
       ├─ Planner / Dispatch   DAG + scoped children
       ├─ Skills / Capabilities / Marketplace
       ├─ Backup tools         verify + restore-test
       └─ Dashboard            loopback read-only
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```powershell
pnpm install
pnpm verify          # typecheck + plugin tests + build
pnpm --filter @dsh-ai-factory/sync-server test
```

Current gate: **125 plugin tests** and **10 sync-server tests**. See
[TEST_REPORT.md](TEST_REPORT.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).

---

# Русский перевод

**DSH AI Factory** — локальная автономная мультиагентная платформа для
DeepSeek Harness Desktop.

Это настоящий host-плагин DSH: он регистрирует инструменты через официальный
`ctx.tools`, хранит состояние в локальном SQLite и переживает перезапуск
приложения.

## Возможности

- **Memory** — пять типов памяти, версии, дедупликация, TTL, FTS5, проекты и
  глобальная область; секреты отклоняются.
- **Tasks** — durable-задачи, зависимости, leases, heartbeat, retry, история,
  восстановление после сбоя.
- **Scoped Allowlist** — у профиля явный `allowedTools`; ребёнок получает только
  его, runtime guard не даёт обойти ограничения.
- **Skills** — project-local `.skills/*.md`, strict frontmatter, root-only
  управление; навыки не расширяют `allowedTools`.
- **Capability Discovery** — статический allowlist, файловое обнаружение без
  команд, safe probes только opt-in, cache-only `check`, `requiresCapabilities`
  на плане/задаче.
- **Agent Marketplace** — экспорт/импорт `.agents/<slug>.json` с проверкой
  `allowedTools`, `accessLevel`, skills и секретов.
- **Backup** — manifest с хэшами таблиц, gzip-архив, `factory_backup_verify` и
  `factory_backup_restore_test`.
- **Dashboard** — локальная read-only панель на `127.0.0.1`.

## Установка

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/install.ps1 `
  -Profile desktop `
  -Tarball .\dist\dsh-ai-factory-1.0.0.tgz
```

После установки перезапустите DSH Desktop и вызовите `factory_status`.

## Безопасность

- allowlist исполняется, а не рекомендуется;
- capability не выдаёт инструменты;
- секреты отклоняются;
- `.agents/`, `.skills/`, БД, бэкапы и локальные данные не попадают в git;
- dashboard доступен только на loopback и не меняет данные.

Лицензия: MIT (см. [LICENSE](LICENSE)).
