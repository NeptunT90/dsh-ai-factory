# План DSH AI Factory

Статусы: `[x]` готово и проверено, `[~]` в работе, `[ ]` не начато,
`[!]` заблокировано внешним фактором.

## Phase 0 — Discovery

- [x] Изучена установленная версия DSH 0.2.2-rc.1, Electron 44.7.0, Node 24.21.
- [x] Найден официальный Cordis plugin API: `apply(ctx, config)`.
- [x] Изучены `ctx.tools`, `defineTool`, `ctx.effect`, `ctx.logger`.
- [x] Проверен формат manifest: `dsh.bundle.patch`.
- [x] Проверен жизненный цикл: регистрация инструментов и disposers.
- [x] Проверено локальное хранилище `node:sqlite` и FTS5 в Node 24.
- [x] Проверена установка в отдельный профиль `factory-test` и загрузка в
      реальном DSH (созданы SQLite-схема и audit-записи).
- [x] Создан [DISCOVERY.md](docs/DISCOVERY.md).
- [ ] Проверить Creator Mode+ на совместимость (не требуется для Phase 1;
      используется только как возможный вспомогательный инструмент позже).

## Phase 1 — Foundation

- [x] Репозиторий, workspace, строгая TypeScript-сборка.
- [x] Настоящий устанавливаемый DSH-плагин (`plugin/package.json`,
      `cordis.patch.yml`, `lib/`).
- [x] Конфигурация с валидацией и безопасными defaults.
- [x] Локальное SQLite-хранилище, WAL, миграции.
- [x] Memory Engine v1: 5 типов, проекты, trust, confidence, TTL, дедупликация,
      версии, soft delete, FTS5-поиск.
- [x] Журналирование: Cordis logger + durable audit.
- [x] Фильтр секретов и маркеры prompt-injection.
- [x] Инструменты `factory_status` и `factory_memory_*`.
- [x] Автотесты и сборка.
- [x] Проверено восстановление данных после закрытия/открытия БД.
- [x] Установка в основной профиль `desktop`; DSH горячо смонтировал плагин,
      audit `factory.tools_registered` = 8; схемы инструментов доставлены в
      текущую Web GUI-сессию.
- [x] Скрипты install/uninstall/backup/restore/doctor; install, backup, doctor
      проверены на реальном профиле.
- [x] Инструменты доставлены в живую Web GUI-сессию (30 схем), плагин
      перезагружен через HMR.
- [~] Вызвать memory-tool из модели и подтвердить запись/чтение (финальный
      smoke-тест).

**Критерий завершения:** плагин установлен в DSH, запускается, сохраняет и
восстанавливает данные, инструменты видны модели.

## Phase 2 — Agent Core

- [x] Agent Registry: 7 профилей (DIRECTOR, RESEARCHER, DEVELOPER, SYSADMIN,
      ANALYST, EXECUTOR, REVIEWER), CRUD, версии, лимиты, доступ.
- [x] DIRECTOR brief с фактическим состоянием фабрики.
- [x] Tool Registry: чтение реального каталога host-tools (`factory_tools_list`).
- [x] Реальный запуск дочернего агента: `factory_dispatch` через
      `ctx.subagents.startActivation` (провайдер `spawn`), ожидание результата,
      завершение связанной задачи.
- [x] Выбор модели из профиля (provider/model/reasoning) передаётся в
      `agentOptions`; иначе ребёнок наследует модель родителя.
- [ ] DIRECTOR как автономный цикл, а не один dispatch-вызов.
- [ ] Принудительное ограничение инструментов агента (scoped restrictions).
- [ ] Model Router с fallback и стоимостью.
- [ ] Brief памяти в начало сессии (проверить `agent.inject`).

**Критерий:** DIRECTOR передаёт задачу специалисту с нужными инструментами, и
результат сохраняется в общей памяти. Достигнут частично: реальный дочерний
агент запускается, результат пишется в Task Engine; автоматического сохранения
в память и ограничения инструментов пока нет.

## Phase 3 — Task Engine

- [x] Таблицы `tasks`, `task_events`; миграция v1→v2 без потери данных.
- [x] Статусы NEW…CANCELLED, приоритеты, зависимости, очередь.
- [x] Planner и сохранение DAG-плана.
- [x] Recovery: lease, heartbeat, retry/backoff, восстановление после сбоя.
- [x] Lazy-продвижение зависимых задач после complete.
- [ ] Workflow Engine: ветвления, параллельные группы, ожидание.
- [x] Execution Engine v1: синхронный `factory_dispatch` запускает исполнителя
      на READY-задаче, heartbeat-ит lease и завершает задачу результатом.
- [x] Bounded autonomous workflow по таймеру + on-demand `factory_auto_workflow`.
- [ ] Runtime-тест: многоэтапная задача переживает реальный restart DSH
      (unit-тест восстановления уже есть).

**Критерий:** задача проходит полный цикл и восстанавливается после сбоя.
Частично достигнут: движок и recovery готовы, автозапуск — нет.

## Phase 4 — Memory / Server

- [x] SQLite outbox, идемпотентные `opId`, версии, retry/backoff.
- [x] Sync client `factory_sync` (status/push/pull), Bearer env-token,
      HTTPS/loopback, LWW pull, cursor.
- [x] Применение remote без обратного outbox (SQLite guard).
- [x] Sync-сервер: PGlite PostgreSQL + pgvector, REST API, Bearer auth.
- [x] Idempotency, LWW upsert, conflict response, Dockerfile/Compose.
- [x] End-to-end: два SQLite-runtime через реальный HTTP-сервер.
- [x] Store/HTTP тесты сервера (5).
- [x] Standalone PostgreSQL adapter + direct TLS.
- [ ] Фактический Ubuntu/Docker deploy + reverse proxy.
- [x] Backup/restore сервера: dump, CLI restore, empty-target guard.
- [x] Backup-планировщик (interval/keep, SHA256, rotation).
- [ ] Multi-writer.
- [ ] CRDT/merge и server-side conflict journal.
- [ ] Автоматический flush outbox по таймеру.
- [ ] Второй физический ПК и production deployment.

## Phase 5 — Specialists and Tools

- [ ] RESEARCHER: web/browser/PDF.
- [ ] DEVELOPER: FS, shell, git, тесты, сборка.
- [ ] SYSADMIN: PowerShell, SSH, Docker, сервисы (с approval-политикой).
- [ ] ANALYST: Python/SQL/CSV/XLSX.
- [ ] EXECUTOR: ограниченные операции.
- [ ] REVIEWER: независимые проверки.
- [ ] Tool Registry и проверки доступности.

## Phase 2c — Scoped tools

- [x] `allowed_tools` в профиле (schema v4), deny-by-default для custom.
- [x] `ctx.agents.create` + `setup(restrict)` для dispatch/review.
- [x] Runtime `ctx.tools.guard` → `TOOL_NOT_ALLOWED`.
- [x] DEVELOPER без dispatch; REVIEWER/RESEARCHER без destructive-tools;
      SYSADMIN только admin.
- [x] Live: RESEARCHER пытается `factory_memory_forget` → отказ, память цела.
- [x] 50 plugin-тестов, docs/ARCHITECTURE/SECURITY.

## Phase 3c — Model Router

- [x] Route priority: profile → parent → modelFallbacks.
- [x] `modelMaxAttempts` 1–3, fallback on child model error, audit.
- [x] `factory_model_route` read-only.
- [x] Live: DEVELOPER/REVIEWER → deepseek-official/deepseek-flash.
- [x] 54 plugin-теста, 35 инструментов.

## Phase 6 — Autonomy and Review

- [ ] SAFE / AUTONOMOUS / TRUSTED.
- [ ] Политики опасных действий и approvals.
- [x] REVIEWER PASS/PASS_WITH_WARNINGS/FAIL через реального child-агента
      (`factory_review`, structured output).
- [x] FAIL создаёт READY-задачу на исправление (`metadata.fixFor`).
- [x] Bounded-цикл dispatch → review → fix → re-review (`factory_workflow_run`,
      maxCycles 1–5).
- [ ] Security Manager и изоляция.

## Phase 7 — Dashboard / Management

- [x] Dashboard v1: Overview, Agents, Tasks, Memory, Audit/Logs, Tools,
      Settings.
- [x] Русский интерфейс, адаптивность, read-only.
- [x] Локальный HTTP только на 127.0.0.1, случайный токен, HttpOnly-cookie,
      CSP/no-store, без внешних ассетов.
- [x] Models и Sync разделы dashboard (read-only).
- [ ] Workflows, Knowledge Base, Scheduler, Security, GitHub
      разделы (сейчас честно показаны как `plan`).
- [ ] Мутации из UI (agent save/task create) с отдельной CSRF/approval
      политикой — не реализованы.
- [ ] Client-plugin внутри Web GUI вместо отдельного loopback-сервера — позже.

## Phase 8 — Self-improvement / Plugin Creator

- [ ] Анализ ошибок и предложения улучшений.
- [ ] Ветка → тесты → review → установка только с подтверждением.
- [ ] Создание DSH-плагинов, проверка совместимости.

## Phase 9 — Release

- [x] Релизный tarball без `node_modules`, проверка обязательных файлов и
      SHA256SUMS (`scripts/package.ps1`).
- [x] Установка из tarball в отдельный профиль `portable-test` (не link),
      boot v0.9.0 с 35 инструментами; upgrade 0.8.0 → 0.9.0.
- [x] GitHub Actions CI + release workflow на тег `v*`.
- [x] README/CHANGELOG/SECURITY, release/portability docs.
- [ ] Тег и GitHub Release (нужен remote/credentials).
- [ ] Физически второй компьютер.
- [ ] Обновление с предыдущей версии без потери данных — backup/update
      скрипты есть, но полный upgrade-тест ещё нужен.
