# Changelog

## [0.7.0] — 2026-11-10

### Added

- `factory_dispatch` параметр `review=true`: успешный child оставляет задачу в
  REVIEW вместо COMPLETED.
- `factory_workflow_run`: bounded-цикл executor → REVIEWER → fix task → repeat,
  `maxCycles` 1–5, статусы PASSED/FAILED/EXHAUSTED/ERROR и история циклов.
- Audit `workflow.*`; fail fix-задачи автоматически диспатчатся следующим
  циклом.
- Live smoke из Web GUI: реальный dispatch (PONG), REVIEWER (PASS), dashboard.
- 4 новых теста (всего 45), 34 инструмента; версия 0.7.0.

## [0.6.0] — 2026-11-10

### Added

- `factory_review`: независимое ревью задачи в REVIEW реальным дочерним
  агентом REVIEWER через `ctx.subagents.startActivation`.
- Structured output schema: `verdict` (PASS/PASS_WITH_WARNINGS/FAIL),
  `summary`, `issues`; fallback по тексту `VERDICT:`.
- PASS/PASS_WITH_WARNINGS закрывают задачу; FAIL переводит её в FAILED и
  создаёт READY-задачу на исправление с `metadata.fixFor`.
- Audit `review.started/completed/failed/error`, child id и fix task.
- 3 reviewer-теста (всего 41), 33 инструмента.
- Версия плагина и sync-сервера 0.6.0.

## [0.5.0] — 2026-11-10

### Added

- Миграция v3: `sync_outbox`, `sync_state`, `sync_apply_guard` и SQLite
  triggers на реальные версии памяти.
- `factory_sync` (status/push/pull/sync) с Bearer-токеном из env, HTTPS или
  loopback HTTP, cursor, idempotent `opId`, retry/backoff.
- `MemoryEngine.applyRemote`: LWW по `updatedAt`, импорт/remap проекта,
  подавление обратного outbox, FTS-обновление.
- 4 sync-теста (всего 38): обмен памятью между двумя SQLite, offline outbox,
  отказ по токену.
- Sync-сервер `server/`: PGlite PostgreSQL + pgvector, REST push/pull/health,
  Bearer auth, idempotency, LWW/conflict, Dockerfile/Compose.
- Auto-sync по таймеру (`syncAuto`/`syncIntervalSeconds`), статус auto/последний sync.
- Backup endpoint `/v1/admin/backup` и `scripts/server-backup.ps1`.
- 5 серверных тестов + end-to-end HTTP между двумя SQLite.
- Release tarball 0.5.0; upgrade `portable-test` 0.4.0 → 0.5.0 без потери
  схемы/данных.

### Known limitations

- Sync-сервер использует embedded PGlite (single writer); standalone
  PostgreSQL/Ubuntu + TLS proxy ещё не развёрнуты.
- Нет автоматического flush outbox/backup-планировщика.
- Second physical PC still pending.

## [0.4.0] — 2026-11-10

### Added

- Локальный read-only dashboard v1:
  - `factory_dashboard` (start/status/stop);
  - сервер только на `127.0.0.1`, ephemeral-порт по умолчанию;
  - случайный токен, редирект из URL в HttpOnly-cookie;
  - CSP, `no-store`, `nosniff`, `X-Frame-Options`;
  - разделы Обзор, Агенты, Задачи, Память, Журнал, Инструменты, Настройки;
  - реальные данные SQLite/реестров, русский адаптивный интерфейс.
- `TaskEngine.listAll`/`statsAll`, `AuditLog.recent` для панели.
- 2 HTTP dashboard-теста (всего 34).
- 31 инструмент в DSH.

### Release / portability

- `scripts/package.ps1`, `verify-package.ps1`, `install.ps1 -Tarball`,
  `update.ps1`, SHA256SUMS.
- Release workflow на тег `v*`.
- Tarball установлен в отдельный профиль `portable-test` без `link:`.

### Security

- Только loopback, токен, отсутствие POST/мутаций, без внешних ассетов.
- Неподдерживаемые подсистемы честно помечены `plan`, без фиктивных данных.

### Known limitations

- Dashboard read-only; Workflows/KB/Models/Scheduler/Security/Server/GitHub
  разделов нет.
- Live-вызов `factory_dashboard` из модели ещё не выполнен.
- Tool allowlist и Model Router — Phase 2c.

## [0.3.0] — 2026-11-10

### Added

- `factory_dispatch`: реальный запуск дочернего агента через официальный
  `ctx.subagents.startActivation` (провайдер `spawn`).
- Дочерняя сессия получает cwd проекта, роль/системную инструкцию профиля,
  модель профиля (если задана) и справочный контекст памяти.
- Dispatch синхронно ждёт `activation.result`, продлевает lease, завершает
  связанную задачу результатом или переводит её в retry/FAILED.
- 3 теста dispatch с fake `SubagentRuntime` (всего 32).
- Зависимость `@deepseek-ai/dsh-subagent` как optional peer и dev dependency.

## [0.2.0] — 2026-11-10

### Added

- Миграция схемы v2: `agent_profiles`, `tasks`, `task_events`.
- Agent Registry: 7 профилей, CRUD, версии, лимиты.
- Task Engine: зависимости, lease, heartbeat, retry/backoff, recovery.
- Planner DAG, `factory_plan_create`, `factory_director_brief`,
  `factory_tools_list`.
- 13 новых тестов (всего 29).

## [0.1.0] — 2026-11-10

### Added

- Устанавливаемый DSH-плагин `dsh-ai-factory` для DSH Desktop 0.2.2-rc.1.
- SQLite (`node:sqlite`), WAL, миграции, FTS5.
- Memory Engine v1, 8 инструментов, фильтр секретов, audit.
- 16 тестов, install/uninstall/backup/restore/doctor.
