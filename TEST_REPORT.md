# TEST_REPORT

Дата: 2026-11-10  
Платформа: Windows 11 x64, Node 22.22.3 (dev), DSH Desktop 0.2.2-rc.1 (Electron 44.7.0, Node 24.21.0)

## 1. Статические проверки

| Проверка | Команда | Результат |
|---|---|---|
| TypeScript strict | `pnpm --filter dsh-ai-factory typecheck` | PASS |
| Сборка | `pnpm --filter dsh-ai-factory build` | PASS, `plugin/lib/index.js` создан |
| Манифесты | `package.json`, `dsh.bundle.patch` | PASS |
| BOM | JSON/YAML/TS без BOM, `.ps1` с BOM | PASS |

## 2. Автотесты

Команда: `pnpm --filter dsh-ai-factory test`

```
Test Files  8 passed (8)
Tests       32 passed (32)
```

Покрыто:

- миграции v1→v2 идемпотентны, проект переживает upgrade;
- транзакции, FTS5, кириллический поиск;
- память: dedupe, версии, TTL, soft delete, `expectedVersion`, секреты;
- seed 7 профилей агентов, CRUD, лимиты, отключение;
- Task Engine: зависимости, claim/lease/heartbeat, retry/backoff, terminal
  guard, лимит параллельных задач, recovery, события;
- Planner: DAG, роли, продвижение зависимых задач, циклы;
- **Dispatch**: успешный дочерний запуск через fake `SubagentRuntime`,
  сохранение output в задачу, COMPLETED; ошибка ребёнка → READY/FAILED;
  отсутствие `ctx.subagents` не захватывает задачу;
- 30 инструментов, включая `factory_dispatch`; tool contract для memory,
  agent, plan, task и brief.

## 3. Интеграция с реальным DSH

### 3.1. `desktop`

- Все прежние 27 плагинов сохранены.
- HMR загрузил AI Factory **v0.3.0**:
  - `factory.started`: `schemaVersion: 2`, `agents: 7`, `tasks: 0`;
  - `factory.tools_registered`: **30**;
  - groups: status, memory, agents, tasks, orchestration, dispatch.
- SQLite: `PRAGMA user_version = 2`; таблицы `agent_profiles`, `tasks`,
  `task_events`; 7 профилей.
- В живую Web GUI-сессию доставлена схема `factory_dispatch` вместе с
  остальными 29 инструментами.
- `doctor.ps1` проходит; данные/схема читаются.

### 3.2. `factory-test`

- Headless boot после исправления BOM: v0.2.0/0.3.0, schema 2, agents 7,
  tools 29/30. Ожидаемая ошибка `MISSING_CREDENTIAL` не связана с плагином.

### 3.3. Dispatch с реальной моделью

Код вызывает **официальный** `ctx.subagents.startActivation`; в профиле
активны `dsh-subagent` и `dsh-subagent-spawn-in-process`. Тест с fake-service
проверяет контракт. Живой запуск с реальной LLM в Web GUI ещё не выполнен:
для него нужен обычный чат-запрос, а текущий клиент не инициирует tool-call
напрямую. Это единственный незакрытый smoke-пункт.

## 4. Инцидент BOM

PowerShell 5.1 `Set-Content -Encoding UTF8` добавил BOM в `package.json`.
HMR выгрузил плагин и не смог импортировать новую версию:

```
SyntaxError: Unexpected token '﻿', ... is not valid JSON
```

BOM удалён; манифест проверен; HMR загрузил v0.2.0, затем v0.3.0. Правило:
JSON/YAML/TS — UTF-8 без BOM; `.ps1` — UTF-8 с BOM.

## 5. Что не проверено

- Живой dispatch с моделью в Web GUI (fake-service тест пройден).
- Ограничение host-tools ребёнка по allowlist профиля — не реализовано.
- Model Router с fallback — не реализован.
- Полный restart DSH после v0.3.0; recovery проверен unit-тестом и startup-хуком.
- Dashboard, server sync, GitHub.

## 6. Повтор проверки

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/doctor.ps1 -Profile desktop
```

Живой smoke в чате:

> Вызови `factory_status`, затем `factory_plan_create` из двух шагов, затем
> `factory_dispatch` для READY-шага.
