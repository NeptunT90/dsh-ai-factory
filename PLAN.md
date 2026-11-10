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
- [ ] Автоматический цикл диспетчеризации без ручного вызова инструмента.
- [ ] Runtime-тест: многоэтапная задача переживает реальный restart DSH
      (unit-тест восстановления уже есть).

**Критерий:** задача проходит полный цикл и восстанавливается после сбоя.
Частично достигнут: движок и recovery готовы, автозапуск — нет.

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
