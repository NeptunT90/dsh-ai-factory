# Changelog

## [0.19.0] — 2026-11-10

### Added

- Tool Health Check for factory_* tools: schema v5 tool_health/history, risk registry,
  TTL 10 minutes, R0/R1/R2 statuses, circuit breaker, mixed-action aggregate.
- `factory_tool_health`, `factory_tool_health_check`, `factory_tool_health_history`;
  health tools are root-only and not in their own risk registry.
- R0 probes via ctx.tools.execute (DSH pipeline), never ToolDefinition.execute.
- R1 = REGISTERED with dependenciesChecked=false; R2 = NOT_TESTABLE.
- effectiveAllowedTools filters only factory_*; host tools pass through.
- Dashboard health columns; docs/TOOL_HEALTH.md.
- Plugin 0.18.0: 67 tests, 39 tools; server 0.17.0.

## [0.18.0] — 2026-11-10

### Fixed

- Host capability allowlist (HOST_TOOL_NAMES/aliases): read/write/edit/pwsh,
  run_code and file aliases are denied by the runtime guard; RESEARCHER loses
  file-tools. Live probe: read → unknown tool "read", write → TOOL_NOT_ALLOWED;
  no direct bypass reproduced.
- AutoWorkflowService.stop() waits an active tick up to 5 s, aborts it on
  timeout and only then disposes the coordinator; audit stop_timeout.
- Fallback is suppressed after the first successful tool result
  (model.fallback_suppressed: tool_side_effect), preventing repeated side effects.
- Original FAILED task becomes COMPLETED after its fix task passes review
  (completeFixed, event completed_after_fix).
- Browser tools added to host-capability guard; NOFILE browser probe.
- Live desktop sync (push 2, remote pull 1) with real memory; config restored.
- Plugin 0.17.0: 59 tests, 36 tools; server 0.17.0.

## [0.17.0] — 2026-11-10

### Fixed

- PgStore reserves `sync_operations.op_id` with ON CONFLICT before applying;
  concurrent duplicate writers now accept the same operation exactly once.
- 10th server test: two PgStore instances over one PostgreSQL, same op → one
  memory row/one operation, both accepted.
- Server release tarball `dsh-ai-factory-sync-server-0.17.0.tgz` with dist,
  restore CLI, Dockerfile/Compose and env example.
- Generated release notes (`scripts/release-notes.mjs`) and GitHub Actions
  `body_path`.
- Clean-room install: npm install --omit=dev (16 packages), health, push/pull.
- Plugin unchanged (0.16.0, 56 tests, 36 tools).

## [0.16.0] — 2026-11-10

### Fixed

- Restored UTF-8 Russian strings in package metadata/tests after legacy
  PowerShell mojibake (FTS query now uses the correct term).

### Added

- `factory_auto_workflow` (36th tool): status/run/start/stop, on-demand
  tick without autoWorkflowEnabled; tick guard against overlap.
- Live run-once: READY task → PASSED, 1 cycle; config restored.
- 56 tests, 36 tools.

## [0.15.0] — 2026-11-10

### Added

- Autonomous bounded workflow: `autoWorkflowEnabled`,
  `autoWorkflowIntervalSeconds`, `autoWorkflowMaxCycles`, `autoWorkflowMaxTasks`.
- Plugin-owned coordinator Agent (ctx.agents.create, root) is the parent for
  workflow children; timer scans READY tasks; audit auto_workflow.*.
- 2 auto-workflow tests (56 total), 35 tools; default disabled.
- Live auto-tick: READY task → workflow PASSED, task COMPLETED; config restored.

## [0.14.0] — 2026-11-10

### Added

- Optional direct TLS for the sync server: `SYNC_TLS_CERT_FILE` and
  `SYNC_TLS_KEY_FILE`; HTTPS URL/health.
- 9th server test: self-signed TLS via openssl, HTTPS /health.
- Docker Compose/env support for optional TLS files.
- Plugin unchanged (0.10.1, 54 tests, 35 tools).

## [0.13.0] — 2026-11-10

### Added

- Standalone PostgreSQL adapter (`pg`) behind `DATABASE_URL`; same
  SyncStore contract as PGlite. Requires pgvector.
- Docker Compose: pgvector/pgvector:pg16 + sync service, healthcheck, pgdata
  volume, `.env.example`.
- 8th server test: PgStore over real PostgreSQL wire protocol (PGlite socket).
- Backup endpoint/scheduler explicitly PGlite-only; PostgreSQL uses pg_dump.
- Plugin unchanged (0.10.1, 54 tests, 35 tools).

## [0.12.0] — 2026-11-10

### Added

- Server scheduled backups: `SYNC_BACKUP_DIR`,
  `SYNC_BACKUP_INTERVAL_HOURS`, `SYNC_BACKUP_KEEP`; tar.gz + SHA256 sidecar,
  rotation; Docker Compose `/backups` volume.
- 7th server test: backup archive + rotation.
- Plugin unchanged (0.10.1, 54 tests, 35 tools).

## [0.11.0] — 2026-11-10

### Added

- Sync server backup/restore: `PGliteStore.restore` via `loadDataDir`,
  `server/scripts/restore.mjs`, guard against non-empty target.
- 6th server test: dump → restore preserves memory + pgvector schema.
- Live CLI restore from real backup: `memories:1`, `operations:2`, `vector:true`.

## [0.10.1] — 2026-11-10

### Fixed

- Fallback diagnostics sanitized: audit/task errors no longer include child session
  event data or system prompt text.
- Live fallback verified: BADROUTE profile with invalid model → route fallback to
  deepseek-official/deepseek-flash; task COMPLETED, audit model.fallback.

## [0.10.0] — 2026-11-10

### Added

- Dashboard tabs «Модели» и «Синхронизация»: read-only Model Router и sync status.
- Capabilities: Dispatch, Model Router, REVIEWER loop, Server sync — ready.
- Settings показывает model/sync config; agents показывают allowedTools и route.
- Live screenshot: `docs/assets/dashboard-models-sync-v0.10.0.png`.
- 54 plugin-теста, 35 инструментов, версия 0.10.0.

## [0.9.0] — 2026-11-10

### Added

- Model Router: `modelRouterEnabled`, `modelFallbacks` (`provider/model`),
  `modelMaxAttempts` (1–3).
- Route priority: profile model → parent model → configured fallbacks.
- Dispatch/review retry the next route after a child model error; audit
  `model.route` and `model.fallback`.
- `factory_model_route` (read-only) показывает primary/fallback/chain.
- 4 model-теста (всего 54), 35 инструментов, версия 0.9.0.
- Live: `factory_model_route` для DEVELOPER/REVIEWER показал
  `deepseek-official/deepseek-flash`.

## [0.8.0] — 2026-11-10

### Added

- Phase 2c: `agent_profiles.allowed_tools` (schema v4), явный allowlist каждого
  профиля.
- `ScopedChildRunner` через `ctx.agents.create` + `setup(restrict)`;
  `factory_dispatch`/`factory_review` больше не используют неограниченный spawn.
- Глобальный `ctx.tools.guard`: вызов вне allowlist возвращает
  `TOOL_NOT_ALLOWED` до выполнения тела инструмента.
- Разделение рекомендаций `tools` и enforcement-поля `allowedTools` в
  `factory_agent_get/save`.
- 5 новых allowlist/scoped-тестов (всего 50), включая RESEARCHER →
  `factory_memory_forget` → `TOOL_NOT_ALLOWED`.
- Live-проверка scoped allowlist и scoped REVIEWER; documentation
  `docs/SCOPED_TOOLS.md`.

## [0.7.1] — 2026-11-10

### Fixed

- `factory_review` на PASS больше не перезаписывает результат исполнителя:
  сохраняется исходный result, затем `--- REVIEW ---` и review-текст.
- Live smoke обнаружил этот дефект; полный live-цикл
  FAIL → fix task → PASS подтверждён.

## [0.7.0] — 2026-11-10

### Added

- `factory_dispatch` параметр `review=true`: успешный child оставляет задачу в
  REVIEW вместо COMPLETED.
- `factory_workflow_run`: bounded-цикл executor → REVIEWER → fix task → repeat,
  `maxCycles` 1–5, статусы PASSED/FAILED/EXHAUSTED/ERROR и история циклов.
- Audit `workflow.*`; fail fix-задачи автоматически диспатчатся следующим
  циклом.
- Live smoke из Web GUI: реальный dispatch (PONG), REVIEWER (PASS),
  workflow REVIEW→PASS, dashboard.
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
