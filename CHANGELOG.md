# Changelog

## [0.2.0] — 2026-11-10

### Added

- Миграция схемы v2: `agent_profiles`, `tasks`, `task_events`; upgrade v1→v2
  без потери данных.
- Agent Registry: 7 встроенных профилей (DIRECTOR, RESEARCHER, DEVELOPER,
  SYSADMIN, ANALYST, EXECUTOR, REVIEWER), CRUD, версии, лимиты, доступ,
  память и включение/отключение.
- Task Engine: приоритеты, зависимости, статусы, атомарный claim с lease,
  heartbeat, review, complete/fail, cancel, ручной retry, retry с backoff,
  recovery просроченных lease, аудит переходов.
- Planner: проверка DAG/циклов, топологическая декомпозиция, назначение ролей.
- Инструменты `factory_plan_create`, `factory_director_brief`,
  `factory_tools_list` и 18 инструментов агентов/задач.
- Durable-восстановление задач при старте плагина.
- 13 новых автотестов (всего 29).

### Fixed

- BOM в `package.json`, из-за которого HMR не загружал bundle.
- Ручной retry теперь расширяет бюджет попыток, иначе задача оставалась
  неисполняемой после FAILED.
- План задачи хранится как произвольный JSON, а не только массив.

### Known limitations

- Профили агентов — конфигурация, а не запущенные LLM-процессы.
- Нет `ctx.agents`-диспетчеризации, Model Router, workflow и автопроверки.
- `node:sqlite` в Node 24 experimental (проверен в DSH).

## [0.1.0] — 2026-11-10

### Added

- Устанавливаемый DSH-плагин `dsh-ai-factory` для DSH Desktop 0.2.2-rc.1.
- SQLite (`node:sqlite`), WAL, миграции, FTS5.
- Memory Engine v1: 5 типов, project/global, trust, confidence, TTL,
  дедупликация, версии, soft delete.
- 8 инструментов: статус и память.
- Фильтр секретов, prompt-injection маркеры, durable audit.
- 16 автотестов; скрипты install/uninstall/backup/restore/doctor.
- Проверка загрузки в изолированном и основном профиле DSH.
