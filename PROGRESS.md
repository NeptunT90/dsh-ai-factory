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
- 29 инструментов; 29 автотестов; сборка и typecheck проходят.
- Плагин обновлён в `desktop`; HMR перезагрузил его: audit
  `factory.started` v0.2.0, schema 2, 7 агентов, 29 инструментов.
- Схемы новых инструментов доставлены в текущую Web GUI-сессию (подтверждено
  обновлением tool schemas).
- Прежние 27 плагинов профиля сохранены.

### Исправлено

- PowerShell 5.1 `Set-Content -Encoding UTF8` добавил BOM в `package.json`,
  из-за чего HMR не смог загрузить bundle. BOM удалён, манифест валиден,
  плагин перезагружен; этот случай занесён в отчёт.

### Открыто

- Вызвать memory/task-tools из модели в Web GUI (схемы уже доставлены).
- Фактический запуск дочерних LLM-агентов через `ctx.agents` и scoped-tools.
- Model Router, workflow-автоматизация, REVIEWER-цикл.
- Проверка записи/чтения после полного перезапуска DSH.
- Dashboard, server sync, GitHub — следующие фазы.
