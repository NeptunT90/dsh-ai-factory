# TEST_REPORT

Дата: 2026-11-10  
Платформа: Windows 11 x64, Node 22.22.3 (dev), DSH Desktop 0.2.2-rc.1 (Electron 44.7.0, Node 24.21.0)

## 1. Статические проверки

| Проверка | Команда | Результат |
|---|---|---|
| TypeScript strict | `pnpm --filter dsh-ai-factory typecheck` | PASS |
| Сборка | `pnpm --filter dsh-ai-factory build` | PASS, `plugin/lib/index.js` создан |
| Манифест без BOM | чтение `plugin/package.json` парсером | PASS |
| Формат `dsh.bundle.patch` | ручная проверка | PASS |

## 2. Автотесты

Команда: `pnpm --filter dsh-ai-factory test`

```
Test Files  7 passed (7)
Tests       29 passed (29)
```

Покрыто:

- миграции v1→v2 идемпотентны; существующий project переживает upgrade;
- транзакция откатывается при ошибке;
- FTS5-таблица и триггеры, кириллический поиск;
- remember → dedupe → search → update → history → forget;
- `expectedVersion`, soft delete, global `user` память, TTL;
- секрет отклоняется до записи;
- seed 7 профилей агентов идемпотентен;
- создание/редактирование/отключение профиля, лимиты;
- запрет назначения задачи отключённому агенту;
- Task Engine: полный цикл, зависимости, lease/heartbeat, retry/backoff,
  terminal guard, лимит параллельных задач;
- recovery просроченного lease и событие `lease_expired`;
- Planner: DAG, назначение ролей, продвижение зависимых задач, циклы;
- монтаж плагина: 29 инструментов;
- tool contract: `factory_agent_list`, `factory_plan_create`,
  `factory_director_brief` реально работают через фейковый DSH-контекст;
- memory-tools пишут/читают SQLite; секрет возвращает tool-error.

## 3. Интеграция с реальным DSH

### 3.1. Изолированный профиль `factory-test`

- `dsh plugin --profile factory-test add link:C:/AI Factory/plugin` — успешно.
- Headless boot после устранения BOM:
  - audit `factory.started` v0.2.0;
  - `schemaVersion: 2`;
  - `agents: 7`;
  - `factory.tools_registered` count 29.
- Ожидаемая ошибка `MISSING_CREDENTIAL` в headless не связана с плагином.

### 3.2. Основной профиль `desktop`

- Backup профиля и данных:
  `backups/profile-desktop-20261110_143438`,
  `backups/factory-20261110_143438`.
- Все прежние 27 плагинов сохранены; версии не менялись.
- HMR перезагрузил AI Factory на живой БД:
  - `factory.started` v0.2.0;
  - `schemaVersion: 2`;
  - `agents: 7`;
  - `tasks: 0`;
  - `factory.tools_registered count: 29`.
- Проверено содержимое SQLite:
  - `PRAGMA user_version = 2`;
  - таблицы `agent_profiles`, `tasks`, `task_events`;
  - 7 включённых профилей: ANALYST, DEVELOPER, DIRECTOR, EXECUTOR,
    RESEARCHER, REVIEWER, SYSADMIN.
- В текущую Web GUI-сессию доставлены **29 схем** инструментов, включая
  `factory_agent_*`, `factory_task_*`, `factory_plan_create`,
  `factory_director_brief`, `factory_tools_list`.
- `scripts/doctor.ps1 -Profile desktop` — без проблем.
- `dsh plugin list` — 28 пакетов, все зависимости разрешены.

### 3.3. Инцидент и исправление

PowerShell 5.1 `Set-Content -Encoding UTF8` добавил BOM в `package.json` при
смене версии. HMR выгрузил старую версию и не смог импортировать новую:

```
SyntaxError: Unexpected token '﻿', "﻿{...}" is not valid JSON
```

BOM удалён (UTF-8 без BOM), манифест проверен; после изменения конфигурации
HMR успешно загрузил v0.2.0. Урок зафиксирован: не использовать
`Set-Content -Encoding UTF8` для JSON в Windows PowerShell 5.1.

## 4. Ограничения / что не проверено

- Вызов инструментов из **модели** в Web GUI: схемы доставлены, но в этой
  клиентской сессии нельзя инициировать tool-call напрямую; нужен обычный
  чат-запрос.
- Фактический запуск дочернего LLM-агента через `ctx.agents` — не реализован
  (Phase 2b), поэтому не тестировался.
- Полный restart DSH после v0.2.0 ещё не выполнен; recovery проверен
  unit-тестом и startup-хуком.
- Workflow/Reviewer-автоматика и dashboard отсутствуют.
- `node:sqlite` выдаёт `ExperimentalWarning`; в DSH работает.

## 5. Повтор проверки

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/doctor.ps1 -Profile desktop
```

Проверка в чате:

> Вызови `factory_status`, затем `factory_director_brief`.

Ожидаемо: `status: ready`, `driver: node:sqlite`, `schemaVersion: 2`,
`agents: 7`, `tasks` соответствует БД.
