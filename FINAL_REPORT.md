# DSH AI Factory — итоговый отчёт

Дата: 2026-11-10. Плагин **dsh-ai-factory 0.23.0**, sync-сервер **0.17.0**,
DSH Desktop **0.2.2-rc.1**, схема SQLite **v7**, **56** инструментов.

## Что внедрено

| Блок | Статус | Доказательство |
|---|---|---|
| DISCOVERY/архитектура | готово | `docs/DISCOVERY.md`, `docs/ARCHITECTURE.md` |
| SQLite storage/migrations | готово | schema v7, миграции v1→v7, тесты |
| Memory Engine | готово | CRUD, версии, FTS5, TTL, import/applyRemote |
| Task Engine | готово | зависимости, claim/lease, retry, recovery |
| Tool/Agent registry | готово | 7 builtin-профилей, CRUD, 56 tools |
| Planner/orchestration | готово | `factory_plan_create`, DAG |
| Dispatch/reviewer | готово | реальные `ctx.agents` children, allowlist |
| Recovery | готово | stale lease, startup recovery |
| Scheduler/autonomy | готово | auto workflow (default off) + `factory_auto_workflow` |
| Security | готово | scoped allowlist, audit, path guards, no secrets |
| Dashboard | готово | loopback read-only HTTP, Models/Sync |
| Sync client | готово | outbox, push/pull, LWW, conflict, auto-sync |
| Sync server | готово | PGlite + standalone PostgreSQL, pgvector, TLS |
| Release | готово | tarballs, SHA256SUMS, notes, tags, workflow |
| Tests | готово | 59 plugin + 10 server |
| Install desktop | готово | live 0.23.0, 51 tools, schema 7 |
| Portable profile | готово | `portable-test` 0.23.0 |

## Live-доказательства

- `factory_status`: 0.23.0, schema 7, 10 профилей (7 builtin + 3 test; `BADROUTE` disabled), 29 задач, 3 памяти.
- Scoped allowlist: RESEARCHER/DEVELOPER получали `TOOL_NOT_ALLOWED`.
- Model fallback: invalid model → `deepseek-flash`, задача COMPLETED.
- Auto workflow: READY-задача → PASSED, 1 цикл; конфиг восстановлен.
- On-demand `factory_auto_workflow run`: READY-задача → PASSED.
- Dashboard Models/Sync открывался на loopback.
- Server clean-room: распаковка tarball, `npm install --omit=dev` (16 packages),
  `/health`, push/pull, `memories:1`, `operations:1`.
- PostgreSQL multi-writer: два PgStore, один `opId` → ровно один apply.
- TLS: self-signed cert, HTTPS health.
- Задача `tsk_37b441ea…` оставлена в `REVIEW` без перезапуска.

## BLOCK 3 Skill Manager (v0.23.0)

- Project-local `.skills/*.md`, strict frontmatter/limits, atomic store, fail-closed resolve.
- Profile + skills are system prompt sections; task remains user; no `complete`.
- 7 root-only management tools; `factory_agent_save skills`; 51 tools, schema v6.
- 108 plugin tests / 10 server; live demo create/assign/dispatch/delete; health 43/51.

## BLOCK 2 Project Context Isolation (v0.19.0)

- `ProjectScopeService` + `PROJECT_MISMATCH`; task/memory ID gates; dispatch/review/workflow caller check.
- Child projectId in prompt/audit; dashboard project filter; root-only sync/auto; override audit.
- 9 project-isolation tests; live A/B cross-project task/memory/dispatch/workflow refusals; dashboard filtered state.
- 76 plugin tests, 10 server.

## BLOCK 1 Tool Health (v0.18.0)

- Migration v5 `tool_health`/`tool_health_history`; risk registry 36 factory tools / 44 actions.
- R0 pure probes через `ctx.tools.execute`; R1 `REGISTERED` dependenciesChecked false; R2 `NOT_TESTABLE`.
- 3 root-only health tools; `effectiveAllowedTools` filters only factory_*; host-tools pass.
- Live: `factory_status` HEALTHY 1 ms; health list 36 factory tools; mixed `factory_sync` HEALTHY with push/pull NOT_TESTABLE.
- Dashboard health columns; 67 plugin tests + 10 server.

## Три проверки (v0.17.0)

- Browser-* добавлены в host-capability guard; NOFILE `browser_open` →
  `unknown tool` (не смонтирован); unit guard для browser_open/click/screenshot.
- SYNCONLY: `factory_sync status` работает, `read` недоступен; `factory_sync`
  принимает только action и работает с памятью/БД, не с произвольным путём.
- Desktop live sync: сервер :8788, push 2, remote pull 1, cursor 3, health
  memories/operations 3/3; конфиг восстановлен, сервер остановлен.

## Четыре внутренних долга (v0.17.0)

- **Host capabilities:** отдельный `HOST_TOOL_NAMES`/aliases guard; RESEARCHER без
  file-tools. Live: read → `unknown tool "read"`, write → `TOOL_NOT_ALLOWED`;
  прямой обход read/write/pwsh не воспроизведён, `run_code` ребёнку не выдаётся.
- **Auto stop:** `stop()` ждёт tick до 5 c, при таймауте abort и только затем
  dispose; тест с зависшим child.
- **Fallback:** повтор подавляется после `successfulTools > 0`
  (`model.fallback_suppressed`), чтобы не повторять side effect.
- **FAIL → fix → PASS:** исходная задача становится COMPLETED
  (`completed_after_fix`), fix-задача остаётся COMPLETED.

## Артефакты

```text
dist/dsh-ai-factory-0.23.0.tgz
  229 933 байт
  749d3e7fb39ec86b61e3e6b144eb649cb5ec07da44a0c90cbe04762d3b823605

dist/dsh-ai-factory-sync-server-0.17.0.tgz
  17 189 байт
  8195dd3bedb33fc527889023428d94abc1890d10949d9e0b48bbd8f22777a6c5
```

`dist/SHA256SUMS` содержит оба файла; release notes —
`dist/RELEASE_NOTES-v0.24.0.md`.

## Ограничения (внешняя инфраструктура)

- Ubuntu/Docker/Compose deploy не выполнялся: в окружении нет Docker/psql;
  standalone PostgreSQL проверен через PostgreSQL wire protocol (PGlite socket).
- GitHub Release не опубликован: нет remote, `gh` и токена. Workflow и
  release notes готовы.
- Второй физический ПК отсутствует; portable-профиль проверен на этой машине.
- Backup endpoint/scheduler — только PGlite; PostgreSQL backup через `pg_dump`.
- Auto workflow не daemon: работает, пока загружен плагин; default off.
- Полный restart DSH Desktop после обновления не выполнялся (HMR).

## Воспроизведение

```powershell
pnpm verify
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-server.ps1
node scripts/release-notes.mjs
```

Установка плагина:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 `
  -Profile desktop -Tarball .\dist\dsh-ai-factory-0.23.0.tgz
```

Проверка в DSH:

> Вызови `factory_status` и покажи сырые поля.
