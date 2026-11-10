# DSH AI Factory — итоговый отчёт

Дата: 2026-11-10. Плагин **dsh-ai-factory 0.17.0**, sync-сервер **0.17.0**,
DSH Desktop **0.2.2-rc.1**, схема SQLite **v4**, **36** инструментов.

## Что внедрено

| Блок | Статус | Доказательство |
|---|---|---|
| DISCOVERY/архитектура | готово | `docs/DISCOVERY.md`, `docs/ARCHITECTURE.md` |
| SQLite storage/migrations | готово | schema v4, миграции v1→v4, тесты |
| Memory Engine | готово | CRUD, версии, FTS5, TTL, import/applyRemote |
| Task Engine | готово | зависимости, claim/lease, retry, recovery |
| Tool/Agent registry | готово | 7 builtin-профилей, CRUD, 36 tools |
| Planner/orchestration | готово | `factory_plan_create`, DAG |
| Dispatch/reviewer | готово | реальные `ctx.agents` children, allowlist |
| Recovery | готово | stale lease, startup recovery |
| Scheduler/autonomy | готово | auto workflow (default off) + `factory_auto_workflow` |
| Security | готово | scoped allowlist, audit, path guards, no secrets |
| Dashboard | готово | loopback read-only HTTP, Models/Sync |
| Sync client | готово | outbox, push/pull, LWW, conflict, auto-sync |
| Sync server | готово | PGlite + standalone PostgreSQL, pgvector, TLS |
| Release | готово | tarballs, SHA256SUMS, notes, tags, workflow |
| Tests | готово | 58 plugin + 10 server |
| Install desktop | готово | live 0.17.0, 36 tools, schema 4 |
| Portable profile | готово | `portable-test` 0.17.0 |

## Live-доказательства

- `factory_status`: 0.17.0, schema 4, 10 профилей (7 builtin + 3 test; `BADROUTE` disabled), 24 задач, 1 активная память.
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
dist/dsh-ai-factory-0.17.0.tgz
  151 694 байт
  f2e473b7bc86626eb3204375882a82f3dba9b9b8bd1f253ac00de797f51dec37

dist/dsh-ai-factory-sync-server-0.17.0.tgz
  17 189 байт
  8195dd3bedb33fc527889023428d94abc1890d10949d9e0b48bbd8f22777a6c5
```

`dist/SHA256SUMS` содержит оба файла; release notes —
`dist/RELEASE_NOTES-v0.17.0.md`.

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
  -Profile desktop -Tarball .\dist\dsh-ai-factory-0.17.0.tgz
```

Проверка в DSH:

> Вызови `factory_status` и покажи сырые поля.
