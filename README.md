# DSH AI Factory

**AI Factory** — устанавливаемый плагин для DeepSeek Harness Desktop 0.2.2-rc.1,
который добавляет долговременную память, проектную привязку и фундамент для
автономной мультиагентной фабрики. Это настоящий host-плагин DSH: он
регистрирует инструменты через официальный `ctx.tools`, хранит данные в
локальном SQLite и переживает перезапуск приложения.

> Статус: **Phase 1 завершена; Phase 2/3 — рабочий фундамент проверен на
> реальном DSH**. Работают память, реестр профилей специалистов, Task Engine
> с зависимостями/lease/retry/recovery, Planner и DIRECTOR brief. Фактический
> запуск дочерних LLM-агентов через `ctx.agents`, Model Router, Workflow
> Engine и REVIEWER-цикл ещё не реализованы и не выдаются за готовые.
> Полный план — в [PLAN.md](PLAN.md).

## Что уже работает

- Устанавливается в профиль DSH как bundle-плагин (`dsh plugin add`).
- Загружается Cordis-загрузчиком DSH; в v0.2.0 регистрирует **29 инструментов**.
- Локальное SQLite-хранилище: `node:sqlite`, WAL, миграции по
  `PRAGMA user_version` (схема **v2**), FTS5-поиск с поддержкой русского текста.
- Память пяти типов: `working`, `episodic`, `semantic`, `project`, `user`.
- Проектная привязка по рабочему каталогу агента; глобальная пользовательская
  память.
- Дедупликация, версии, мягкое удаление, история изменений, TTL.
- Фильтр секретов: токены/ключи не попадают в память.
- **Agent Registry**: 7 встроенных профилей (DIRECTOR, RESEARCHER, DEVELOPER,
  SYSADMIN, ANALYST, EXECUTOR, REVIEWER) + пользовательские профили.
- **Task Engine**: статусы NEW…CANCELLED, приоритеты, зависимости, leases,
  heartbeat, retry с backoff, восстановление просроченных задач после сбоя,
  история событий.
- **Planner**: декомпозиция цели в DAG задач с назначением ролей; завершённая
  зависимость автоматически делает следующий шаг READY.
- **DIRECTOR brief**: фактическое состояние проекта, агентов, задач, памяти и
  следующие действия для главного агента.
- **Tool Registry**: `factory_tools_list` читает реальный реестр инструментов
  DSH, видимых текущему агенту.
- Аудит действий без записи содержимого памяти.
- 29 автотестов Vitest (миграции, память, агенты, задачи, planner, tool
  contract), строгая типизация TypeScript, сборка в `lib/`.
- Проверено в реальном Electron-процессе DSH: схема v2, 7 агентов, 29
  инструментов, audit `factory.started`; драйвер — `node:sqlite`.

## Инструменты

### Память и диагностика

| Инструмент | Назначение |
|---|---|
| `factory_status` | Состояние плагина, драйвер, схема, агенты, задачи, память |
| `factory_memory_remember` | Записать факт/решение/предпочтение с дедупликацией |
| `factory_memory_search` | FTS5-поиск по проекту и глобальной памяти |
| `factory_memory_get` | Прочитать запись по id |
| `factory_memory_update` | Исправить запись с историей версий |
| `factory_memory_forget` | Мягко удалить запись |
| `factory_memory_history` | История версий записи |
| `factory_memory_stats` | Статистика локального хранилища |

### Агенты

| Инструмент | Назначение |
|---|---|
| `factory_agent_list` | Профили специалистов, роли, доступ |
| `factory_agent_get` | Полный профиль по id |
| `factory_agent_save` | Создать или изменить профиль с версией |
| `factory_agent_toggle` | Включить/отключить профиль |

### Задачи

| Инструмент | Назначение |
|---|---|
| `factory_task_create` | Создать durable-задачу |
| `factory_task_list` / `get` | Список и чтение задач |
| `factory_task_update` | Изменить задачу до терминального статуса |
| `factory_task_claim` | Атомарно взять READY-задачу с lease |
| `factory_task_heartbeat` | Продлить lease |
| `factory_task_review` | Передать в REVIEW |
| `factory_task_complete` / `fail` | Завершить или зафиксировать ошибку |
| `factory_task_cancel` / `retry` | Отменить или вернуть FAILED в READY |
| `factory_task_recover` | Восстановить задачи с истёкшим lease |
| `factory_task_events` / `stats` | История и статистика |

### Оркестрация

| Инструмент | Назначение |
|---|---|
| `factory_plan_create` | DAG-план из шагов, ролей и зависимостей |
| `factory_director_brief` | Фактический брифинг для DIRECTOR |
| `factory_tools_list` | Реальные инструменты DSH, видимые агенту |

Память и задачи не являются «магическими»: модель должна вызывать инструменты.
Профили агентов — это durable-конфигурация ролей, а не самозапускающиеся
LLM-процессы. Автоматическая передача задачи дочернему `ctx.agents` — Phase 2b.

## Требования

- DeepSeek Harness Desktop **0.2.2-rc.1** (Desktop 44.7.0, Node 24.21).
- Профиль DSH (`desktop` по умолчанию).
- Windows 11 x64 — целевая платформа; код не содержит абсолютных путей и
  привязан к API версии DSH, а не к одному ПК.
- Для сборки из исходников: Node.js >= 22.19, pnpm.

## Установка из исходников

```powershell
git clone <repo-url> dsh-ai-factory
cd dsh-ai-factory
pnpm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop
```

Скрипт:

1. делает резервную копию `package.json`, `cordis.patch.yml` и lock-файла
   профиля;
2. собирает плагин (`pnpm --filter dsh-ai-factory build`);
3. устанавливает локальную ссылку через официальный `dsh plugin add`;
4. проверяет, что пакет и bundle-строка появились в профиле.

Если DSH не применил новый bundle на лету, перезапустите приложение. После
запуска вызовите в чате:

> Вызови `factory_status` и покажи сырые поля.

Ожидаемый ответ: `status: ready`, `driver: node:sqlite`,
`schemaVersion: 2`, `agents: 7`.

### Установка на второй компьютер

Переносите **исходники**, а не `node_modules`. На втором ПК:

```powershell
git clone <repo-url> dsh-ai-factory
cd dsh-ai-factory
pnpm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop
```

Данные памяти лежат отдельно в `%USERPROFILE%\.dsh\ai-factory` и не входят в
git. Для переноса памяти используйте `scripts/backup.ps1` /
`scripts/restore.ps1`; для синхронизации между ПК — серверный этап (Phase 4).

## Конфигурация

Настройки задаются в `cordis.patch.yml` профиля по id `ai-factory`. Пример —
[config/examples/profile-patch.yml](config/examples/profile-patch.yml).
Основные поля:

| Поле | По умолчанию | Смысл |
|---|---|---|
| `dataDir` | `~/.dsh/ai-factory` | Каталог локальных данных |
| `dbFile` | `factory.db` | Имя SQLite-файла |
| `maxSearchResults` | `20` | Лимит результатов поиска |
| `workingMemoryTtlHours` | `72` | TTL рабочей памяти |
| `maxContentChars` | `100000` | Лимит одной записи |
| `allowGlobalMemory` | `true` | Разрешить глобальную память |
| `projectIdOverride` | `""` | Один project id для переносимого проекта |
| `redactLogs` | `true` | Редактировать секреты в аудите |
| `defaultAutonomy` | `autonomous` | Запасной уровень автономности |

Секреты в конфигурации не хранятся. API-ключи DSH остаются в его credential
service.

## Данные и приватность

- По умолчанию: `%USERPROFILE%\.dsh\ai-factory\factory.db` (+ WAL).
- Каталог создаётся с ограниченными правами (на POSIX — `0700`).
- Память привязана к проекту по canonical path рабочего каталога агента.
  `projectIdOverride` позволяет использовать один id на разных ПК.
- В память не пишутся секреты; при обнаружении ключа инструмент возвращает
  ошибку `SECRET_DETECTED`.
- Аудит хранит метаданные (id, тип, результат), но не текст памяти.
- Удаление плагина не удаляет данные; для очистки нужен явный
  `scripts/uninstall.ps1 -PurgeData`.

## Разработка

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Тесты не требуют запущенного DSH. Они используют временные SQLite-базы и
проверяют миграции v1→v2, FTS5, дедупликацию, версии, TTL, фильтр секретов,
реестр агентов, зависимости задач, lease/retry/recovery, planner и регистрацию
инструментов через фейковый Cordis-контекст.

Структура:

```
plugin/                 устанавливаемый npm-пакет
  src/core/             ошибки, id, JSON, безопасность, workspace
  src/storage/          SQLite и миграции v1/v2
  src/memory/           Memory Engine и инструменты
  src/agents/           профили специалистов и реестр
  src/tasks/            Task Engine, статусы, lease, recovery
  src/planner/          DAG-планировщик
  src/orchestration/    DIRECTOR brief и реестр инструментов
  src/projects/         проектный реестр
  src/tools/            диагностика
  tests/                Vitest
docs/                   DISCOVERY, ARCHITECTURE, PLAN, отчёты
scripts/                install / uninstall / backup / restore / doctor
config/                 примеры конфигурации
```

## Ограничения текущей фазы

- Нет семантического поиска на embeddings: сейчас честный FTS5/BM25;
  векторный поиск появится вместе с pgvector (Phase 4).
- Нет автоматической инъекции памяти в промпт: инструменты вызываются моделью.
- Профили агентов не запускают LLM сами: фактический вызов `ctx.agents`,
  Model Router и workflow-цикл — Phase 2b/3b.
- Нет автоматического REVIEWER-цикла и dashboard/GitHub/сервера.
- `node:sqlite` помечен в Node 24 как experimental. Плагин проверяет драйвер и
  сообщает об ошибке; в DSH 0.2.2-rc.1 он проверен и работает.
- HMR-применение нового bundle зависит от настроек профиля; если плагин не
  появился — перезапустите DSH.

## Документация

- [DISCOVERY.md](docs/DISCOVERY.md) — факты о DSH и API.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — архитектура и границы модулей.
- [PLAN.md](PLAN.md) — этапы и критерии.
- [PROGRESS.md](PROGRESS.md) — текущий прогресс.
- [TEST_REPORT.md](TEST_REPORT.md) — результаты проверок.
- [SECURITY.md](SECURITY.md) — модель угроз и правила.

## Лицензия

MIT. См. [LICENSE](LICENSE).
