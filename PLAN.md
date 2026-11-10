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
- [~] Вызвать memory-tool из модели и подтвердить запись/чтение (финальный
      smoke-тест).

**Критерий завершения:** плагин установлен в DSH, запускается, сохраняет и
восстанавливает данные, инструменты видны модели.

## Phase 2 — Agent Core

- [ ] DIRECTOR как оркестратор (не «промпт», а сервис с состоянием).
- [ ] Agent Registry: профили RESEARCHER, DEVELOPER, SYSADMIN, ANALYST,
      EXECUTOR, REVIEWER.
- [ ] Динамическое создание/редактирование агентов, лимиты, права.
- [ ] Agent Communication через `ctx.agents`/subagent-механизм DSH.
- [ ] Model Router: основная/резервная модель, выбор по роли.
- [ ] Tool Registry: каталог, проверка доступности, привязка к агентам.
- [ ] Brief памяти в начало сессии (проверить `agent.inject`).

**Критерий:** DIRECTOR передаёт задачу специалисту с нужными инструментами, и
результат сохраняется в общей памяти.

## Phase 3 — Task Engine

- [ ] Таблицы `tasks`, `task_events`, `leases`.
- [ ] Статусы NEW…CANCELLED, очереди, приоритеты, зависимости.
- [ ] Planner и сохранение плана.
- [ ] Workflow Engine: последовательность/параллельность/ветвления/retry.
- [ ] Execution Engine с таймаутами и отменой.
- [ ] Recovery: lease, heartbeat, восстановление после перезапуска.
- [ ] Runtime-тест: многоэтапная задача переживает restart.

**Критерий:** задача проходит полный цикл и восстанавливается после сбоя.

## Phase 4 — Memory / Server

- [ ] PostgreSQL + pgvector, REST API, авторизация.
- [ ] Outbox, идемпотентность, версии, конфликты.
- [ ] LWW/CRDT-политика конфликтов и журнал синхронизации.
- [ ] Backup/restore сервера.
- [ ] Локальная работа при недоступном сервере.

## Phase 5 — Specialists and Tools

- [ ] RESEARCHER: web/browser/PDF.
- [ ] DEVELOPER: FS, shell, git, тесты, сборка.
- [ ] SYSADMIN: PowerShell, SSH, Docker, сервисы (с approval-политикой).
- [ ] ANALYST: Python/SQL/CSV/XLSX.
- [ ] EXECUTOR: ограниченные операции.
- [ ] REVIEWER: независимые проверки.
- [ ] Tool Registry и проверки доступности.

## Phase 6 — Autonomy and Review

- [ ] SAFE / AUTONOMOUS / TRUSTED.
- [ ] Политики опасных действий и approvals.
- [ ] REVIEWER PASS/PASS_WITH_WARNINGS/FAIL.
- [ ] Цикл исправлений с лимитом попыток.
- [ ] Security Manager и изоляция.

## Phase 7 — Dashboard / Management

- [ ] Overview, Agents, Tasks, Workflows, Tools, Memory, KB, Models,
      Scheduler, Logs, Security, Settings, Server, GitHub.
- [ ] Русский интерфейс, адаптивность.
- [ ] Локальный HTTP с токеном либо client-plugin.

## Phase 8 — Self-improvement / Plugin Creator

- [ ] Анализ ошибок и предложения улучшений.
- [ ] Ветка → тесты → review → установка только с подтверждением.
- [ ] Создание DSH-плагинов, проверка совместимости.

## Phase 9 — Release

- [ ] Полный прогон тестов и установки на втором ПК.
- [ ] GitHub Actions, теги v0.1.0 / v0.2.0 / v0.3.0 / v1.0.0.
- [ ] README/CHANGELOG/SECURITY, релизный пакет.
