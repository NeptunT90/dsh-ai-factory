# Прогресс

## 2026-11-10

### Discovery

- Подтверждена версия DSH 0.2.2-rc.1, Electron 44.7.0, Node 24.21, pnpm 11.28.5.
- Извлечены официальные type-пакеты DSH; изучены `dsh-tools`, `dsh-agent`,
  Cordis, `dsh-package-manifest`.
- Подтверждены `defineTool`, `ctx.tools.register`, `ctx.effect`, `ctx.logger`,
  `ctx.agents`.
- Создан [DISCOVERY.md](docs/DISCOVERY.md).

### Foundation v0.1.0

- Создан workspace и пакет `plugin/` с ESM + TypeScript strict.
- SQLite: `node:sqlite`, WAL, миграции, FTS5.
- Memory Engine: 5 типов, project/global, dedupe, версии, TTL, soft delete.
- Фильтр секретов, prompt-injection маркеры, durable audit.
- 8 инструментов; 16 тестов.
- Плагин установлен в изолированный `factory-test`; DSH создал схему v1.
- `node:sqlite` подтверждён в реальном Electron-процессе DSH.

### Orchestration v0.2.0

- Миграция v2: `agent_profiles`, `tasks`, `task_events`; применена на живой БД
  без потери данных v1.
- Agent Registry:
  - 7 встроенных профилей: DIRECTOR, RESEARCHER, DEVELOPER, SYSADMIN,
    ANALYST, EXECUTOR, REVIEWER;
  - пользовательские профили, версии, лимиты, доступ, память, вкл/выкл;
  - идемпотентный seed, не перезаписывающий правки.
- Task Engine:
  - статусы NEW…CANCELLED, приоритеты, зависимости;
  - атомарный claim с lease и лимитом параллельных задач агента;
  - heartbeat, review, complete/fail, cancel, retry;
  - retry с экспоненциальным backoff и расширением бюджета при ручном retry;
  - восстановление просроченных lease при старте;
  - `task_events` — история переходов;
  - автоматическое продвижение зависимых WAITING → READY.
- Planner: DAG-проверка, топологическая сортировка, назначение ролей,
  `factory_plan_create`.
- DIRECTOR brief и `factory_tools_list` (реальный каталог host-tools).
- 29 инструментов; 29 автотестов; сборка и typecheck проходят (v0.2.0).
- Плагин обновлён в `desktop`; HMR перезагрузил его: audit
  `factory.started` v0.2.0, schema 2, 7 агентов, 29 инструментов.
- Схемы новых инструментов доставлены в текущую Web GUI-сессию (подтверждено
  обновлением tool schemas).
- Прежние 27 плагинов профиля сохранены.

### Real Dispatch v0.3.0

- Добавлен `factory_dispatch`: реальный дочерний агент через официальный
  `ctx.subagents.startActivation` (провайдер `spawn`).
- Ребёнок получает отдельную сессию, cwd проекта, системную инструкцию профиля,
  модель профиля (если задана) и справочный контекст памяти.
- Плагин ждёт `activation.result`, обновляет Task Engine (COMPLETED или
  retry/FAILED), продлевает lease во время работы и корректно освобождает
  активацию.
- 32 автотеста; dispatch проверен с fake SubagentRuntime (успех, ошибка ребёнка,
  отсутствие сервиса).
- Плагин v0.3.0 загружен в DSH: schema 2, 7 агентов, **30 инструментов**;
  схема `factory_dispatch` доставлена в Web GUI-сессию.
- Ограничение: профильный allowlist инструментов пока не enforced; Model Router
  без fallback; автоматического цикла DIRECTOR нет.

### Dashboard v0.4.0

- Локальный read-only dashboard: `factory_dashboard` (start/status/stop).
- Сервер только на 127.0.0.1, случайный токен, HttpOnly-cookie после
  одноразового URL, CSP/no-store, без внешних ассетов.
- Разделы: Обзор, Агенты, Задачи, Память, Журнал, Инструменты, Настройки;
  неподдерживаемые подсистемы честно помечены `plan`.
- Данные реальные: SQLite, 7 профилей, задачи, память, audit, host-tools.
- Панель проверена в браузере (Overview/Agents/Tasks/Settings), скриншот
  снят; HTTP-тесты покрывают auth, redirect-cookie, read-only и stop.
- 34 автотеста; плагин v0.4.0, 31 инструмент.

### Release / portability v0.4.0

- `scripts/package.ps1`: build → `pnpm pack` → проверка архива → SHA256SUMS.
- `scripts/verify-package.ps1`: обязательные файлы, версия, отсутствие
  `node_modules`.
- `scripts/install.ps1 -Tarball`: установка релизного пакета официальным
  `dsh plugin add`; `update.ps1` делает backup перед обновлением.
- Tarball `dist/dsh-ai-factory-0.4.0.tgz` (110432 байт) проверен.
- Установлен из tarball в отдельный профиль `portable-test` как обычная папка
  (не link); DSH загрузил v0.4.0, 31 инструмент.
- Добавлены `.github/workflows/release.yml`, `docs/release.md`,
  `docs/portability.md`, package README/LICENSE.

### Sync foundation v0.5.0

- Миграция v3: `sync_outbox`, `sync_state`, `sync_apply_guard` и SQLite
  triggers на реальные версии памяти.
- `factory_sync`: status/push/pull/sync; Bearer-токен только из env;
  HTTPS/loopback; cursor; backoff.
- `MemoryEngine.applyRemote`: LWW по updatedAt, импорт проекта, подавление
  обратного outbox, FTS-обновление.
- 4 sync-теста: push из A → pull в B, offline outbox/backoff, отказ по токену,
  auto-sync timer.
- Auto-sync по таймеру (`syncAuto`/`syncIntervalSeconds`) и status.
- Backup endpoint `/v1/admin/backup` + `scripts/server-backup.ps1`.
- 38 plugin-тестов, 5 server-тестов; live v0.5.0, schema 3, 32 инструмента.
- Sync-сервер `server/` на PGlite (PostgreSQL/WASM) + pgvector, Bearer auth,
  idempotency, LWW/conflict, Dockerfile/Compose и 5 node --test тестов.
- End-to-end: два SQLite-runtime через реальный HTTP-сервер; health
  `vector: true`, обновление памяти дошло до второй БД.
- Standalone PostgreSQL/Ubuntu и TLS proxy ещё не развёрнуты.

### Reviewer v0.6.0

- `factory_review`: REVIEW-задача → реальный child REVIEWER через
  `ctx.subagents.startActivation` + structured output.
- PASS/PASS_WITH_WARNINGS закрывают задачу; FAIL → FAILED + READY fix-задача
  с `metadata.fixFor`.
- Audit review.*, 33 инструмента, 41 plugin-тест.

### Workflow v0.7.0

- `factory_dispatch review=true` → REVIEW.
- `factory_workflow_run`: dispatch → REVIEWER → fix → repeat, maxCycles 1–5.
- PASSED/FAILED/EXHAUSTED/ERROR, история циклов, audit workflow.*.
- Live smoke из Web GUI: реальный dispatch (PONG), реальный REVIEWER (PASS),
  workflow REVIEW→PASS, dashboard с audit review.*.
- 45 plugin-тестов, 34 инструмента.

### Standalone PostgreSQL v0.13.0

- PgStore (`pg`) + DATABASE_URL; Compose pgvector; 8 server tests.
- Wire-protocol test; Docker не запускался.

### Scheduled backups v0.12.0

- `BackupScheduler` + SHA256 sidecar + rotation; env/Compose.
- 7 server-тестов.

### Backup/restore server v0.11.0

- PGlite restore via loadDataDir; empty-target guard; CLI script.
- Test dump→restore; live CLI memories=1/ops=2/vector=true.
- 6 server tests.

### Live fallback v0.10.1

- BADROUTE invalid model → deepseek-flash fallback; COMPLETED, audit model.fallback.
- Diagnostics sanitized (no system prompt/event data).

### Dashboard Models/Sync v0.10.0

- Вкладки «Модели» и «Синхронизация»; capabilities ready.
- Live screenshot `docs/assets/dashboard-models-sync-v0.10.0.png`.
- 54 теста, 35 инструментов.

### Model Router v0.9.0

- Route plan: профиль → родитель → `modelFallbacks`, max 3 attempts.
- Dispatch/review retry fallback on child error; audit model.route/fallback.
- `factory_model_route` live: deepseek-official/deepseek-flash.
- 54 теста, 35 инструментов.

### Phase 2c — scoped allowlist v0.8.0

- Schema v4: `agent_profiles.allowed_tools`, UI tools `allowedTools`.
- `ctx.agents.create` + setup restrict + global tool guard.
- RESEARCHER live: `factory_memory_forget` → `TOOL_NOT_ALLOWED`, память цела.
- Scoped REVIEWER live PASS; 50 plugin-тестов.

### Fixed v0.7.1

- REVIEWER PASS сохраняет executor result (раньше перезаписывал review-текстом);
  live smoke выявил дефект, тест проверяет оба текста.

### Исправлено

- PowerShell 5.1 `Set-Content -Encoding UTF8` добавил BOM в `package.json`,
  из-за чего HMR не смог загрузить bundle. BOM удалён, манифест валиден,
  плагин перезагружен; этот случай занесён в отчёт.

### Открыто

- Живой smoke memory/task/dispatch/dashboard из модели в Web GUI (схемы
  доставлены; текущий клиент не инициирует tool-call).
- Scoped-ограничение host-tools дочернего агента; Model Router.
- Автономный DIRECTOR/REVIEWER-цикл, workflow-ветвления.
- Полный restart DSH и повторная проверка данных.
- Server sync, GitHub, release, второй ПК.
