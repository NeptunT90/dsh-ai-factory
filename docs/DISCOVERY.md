# DISCOVERY — DSH AI Factory

Дата исследования: 2026-11-10  
Целевая платформа: DeepSeek Harness Desktop **0.2.2-rc.1**  
Профиль: `desktop` (`C:\Users\drgnu\.dsh\profiles\desktop`)

Документ фиксирует только проверенные факты. Всё, что не удалось подтвердить
экспериментом, вынесено в раздел «Открытые вопросы»; неподтверждённые API не
используются в коде.

## 1. Фактическая установка

| Факт | Проверенное значение |
|---|---|
| Приложение | `C:\Users\drgnu\AppData\Local\Programs\DeepSeek Harness` |
| Версия Desktop | `0.2.2-rc.1` (`resources/runtime/primary-runtime/runtime.json`) |
| Версия Electron | 44.7.0 (`version` в каталоге приложения) |
| Node.js хоста | **24.21.0** (поставляется в primary-runtime) |
| pnpm хоста | 11.28.5 |
| Код DSH | `resources/app.asar` (упакован, 213 МБ); распакованные native-модули — `resources/app.asar.unpacked` |
| CLI | `resources/runtime/cli/bin/dsh.cmd` |
| Профиль | `%USERPROFILE%\.dsh\profiles\desktop` |
| Пакеты профиля | `node_modules` + `package.json` + `cordis.patch.yml` |
| Плагины профиля | 27 пакетов, включая `dsh-openwolf`, `dsh-office-toolkit`, `dsh-db-tool` |

Проверенная команда:

```powershell
& "C:\Users\drgnu\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" --version
# 0.2.2-rc.1
```

`dsh plugin --profile desktop <pnpm args>` — официальная точка управления
зависимостями профиля; аргументы после `plugin` передаются в pnpm, запущенный
в каталоге профиля.

## 2. Архитектура плагина DSH

DSH использует **Cordis** (fork/родственный проект с сервисным контекстом).
Плагин — ES-модуль, который экспортирует:

```ts
export const name = 'ai-factory'
export const inject = ['tools']
export const Config = Schema.object({ /* ... */ })
export function apply(ctx: Context, config: Config): void
```

Проверено на работающих плагинах `dsh-openwolf` и `dsh-office-toolkit`:
- `apply` вызывается при монтировании строки конфигурации;
- `inject: ['tools']` гарантирует, что сервис `ctx.tools` уже существует;
- регистрация инструмента: `ctx.tools.register(defineTool({...}))`;
- регистрация возвращает disposer; жизненный цикл привязывается к `ctx.effect`;
- логгер: `ctx.logger('имя')` или `ctx.logger.info(...)`;
- `ctx.effect(() => { ...; return dispose }, 'label')` — штатный способ
  освободить SQLite-соединение, таймеры и слушатели при выгрузке плагина.

Cordis `Context` типизирован; `ctx.tools` добавляется через module augmentation
в `@deepseek-ai/dsh-tools`, `ctx.agents` — в `@deepseek-ai/dsh-agent`.

## 3. Manifest и установка

Пакет плагина — обычный npm-пакет. Для загрузки в профиль нужны три вещи:

1. зависимость в `package.json` профиля:
   ```json
   "dependencies": { "dsh-ai-factory": "link:C:/AI Factory/plugin" }
   ```
   (для локальной разработки; для релиза — версия из registry или git/tarball);
2. имя пакета в упорядоченном списке `dsh.profile.bundles`;
3. в самом пакете — поле
   ```json
   "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
   ```

`cordis.patch.yml` — слой композиции над пустым корнем профиля. Минимальная
строка плагина:

```yaml
- insert:
    - id: ai-factory
      name: dsh-ai-factory
```

Порядок слоёв: `@deepseek-ai/dsh-base` → `@deepseek-ai/dsh-web-app` → остальные
bundles в порядке `dsh.profile.bundles` → `cordis.patch.yml` профиля. Более
поздний слой может переопределить строку по `id`.

Проверено: `dsh.profile.bundles` в профиле `desktop` содержит 30 записей
(включая AI Factory),
`cordis.patch.yml` профиля — массив override-записей. HMR-плагин активен
(`include:hmr`), и в Phase 1/2 новый bundle был смонтирован в работающий DSH
без перезапуска. После изменения `cordis.patch.yml` HMR выгружает и загружает
строку плагина; при ошибке импорта строка остаётся выгруженной до исправления
и следующего изменения конфигурации. Перезапуск нужен, если HMR отключён или
профиль startup-only.

## 4. Tool API (dsh-tools 0.2.2-rc.1)

`defineTool` требует:
- `name`, `description`;
- `parameters` — **плоская карта** свойств, а не полный JSON Schema:
  ```ts
  parameters: {
    query: { type: 'string', required: true, description: '...' },
    limit: { type: 'number', description: '...' },
  }
  ```
- `output.schema` — полная JSON-схема канонического результата;
- `output.render(args, value)` — чистая функция, возвращающая `ContentBlock[]`;
- `execute(args, exec)` — асинхронная функция, возвращающая JSON-значение,
  соответствующее `output.schema`.

`exec` (`ToolRunContext`) содержит `agent?: Agent`, `signal`, `callId`,
`deferContext`, `concludeTurn`. Отмена передаётся через `exec.signal`.

Регистрация:

```ts
const dispose = ctx.tools.register(defineTool({ ... }))
```

Инструменты видны модели после регистрации; описание и схема попадают в запрос.
Код не должен самовольно выполнять модель — только возвращать результат
инструмента.

## 5. Агенты, сессии и подагенты

`ctx.agents` — реестр живых агентов (`AgentRegistry`), `Agent` имеет
`id`, `session`, `model`, `inbox`, `ctx`, `send`, `inject`, `followup`,
`whenIdle`, `cancel`. Прямое создание агента — через `ctx.agents.create()`,
которое делегируется фабрике `@deepseek-ai/dsh-agent-loop`; для него обязательны
`sessionId`, `meta.cwd` и т.п.

Для делегирования в DSH есть специализированный официальный seam
`ctx.subagents` (`@deepseek-ai/dsh-subagent`):

- провайдер `spawn` (`@deepseek-ai/dsh-subagent-spawn-in-process`) запускает
  дочернего агента в отдельной сессии;
- `startActivation({ provider, label, request, signal, delivery })` возвращает
  `{ childId, result, dispose }`;
- `request` содержит `prompt: ContentBlock[]`, `parent: Agent`, optional `cwd`,
  `agentOptions`, `maxDepth`; `delivery: 'caller'` позволяет дождаться
  результата без parent-notice;
- `result` содержит `output`, `structured`, `diagnostic`, `stopReason`.

AI Factory использует именно этот seam (`factory_dispatch`), а не имитацию
агентов промптами. Дочерний агент реально выполняется в процессе DSH; его
инструменты пока наследуют composition родителя, а не allowlist профиля —
это ограничение Phase 2c.

`@deepseek-ai/dsh-session` — durable event log; `agent/created` и
`agent/session-start` доступны плагинам, но dispatch не зависит от ручного
чтения event log: результат отдаёт `activation.result`.

## 6. Хранилище

В `@deepseek-ai/dsh-base` уже смонтированы:
- `@deepseek-ai/dsh-storage` (hub);
- `@deepseek-ai/dsh-storage-json` (backend, root `dshHomePath('storages')`);
- `@deepseek-ai/dsh-storage-domain` (schema-validated KV domains, `backend: json`).

Это официальный путь для host-side данных, не входящих в session log.
Однако ТЗ требует локальный **SQLite** и контроль версий/поиск. Поэтому AI
Factory использует собственный SQLite-слой (`node:sqlite`, встроен в Node 24)
как основной, а `ctx.storageDomain` — как возможный будущий адаптер.

Проверено в Node 24.21:
```js
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(':memory:')
db.exec('CREATE VIRTUAL TABLE f USING fts5(a, b)') // FTS5 доступен
```
FTS5 поддерживает кириллицу. `node:sqlite` не требует native-сборки и
переносим между Windows/Linux при одинаковой версии Node/DSH. Это важно для
требования установки на второй компьютер.

Ограничение: `node:sqlite` в Node 24 ещё помечен experimental. Плагин обязан
проверять драйвер при старте и явно сообщать об ошибке, а не молча подменять
хранилище. Тест в реальном Electron-процессе DSH будет выполнен после
установки Phase 1; если API там недоступен, будет добавлен проверенный
fallback (не имитация).

## 7. Ресурсы и жизненный цикл

- Плагин живёт в процессе Host; код имеет доступ к файловой системе и сети в
  рамках политики DSH, но обязан сам ограничивать свои действия.
- Инструменты выполняются в контексте агента; `exec.signal` — единственный
  корректный механизм отмены.
- Состояние должно переживать перезапуск: SQLite + WAL, миграции по
  `PRAGMA user_version`, идемпотентная инициализация.
- Нельзя писать в исходники DSH; все данные — в `%USERPROFILE%\.dsh\ai-factory`
  (настраивается) и в рабочем каталоге проекта.
- Секреты не хранятся в коде и не пишутся в память; встроенный фильтр
  секретов обязателен.

## 8. Проверенные ограничения и решения

| Вопрос | Факт | Решение |
|---|---|---|
| Где исходники DSH? | в `app.asar`, не в обычной папке | для исследования распакованы в `.research` (не коммитится) |
| Можно ли менять DSH? | запрещено ТЗ | изменения только в отдельном пакете профиля |
| Как установить локальный плагин? | `dsh plugin --profile desktop add <spec>` + bundle selection | скрипт установки с backup и проверкой |
| Нужен ли native build? | `node:sqlite` встроен | нет native-зависимостей для хранилища |
| Как проверять UI? | Web GUI на `http://127.0.0.1:64677` | после установки — реальный tool-call в сессии; отдельный dashboard позже |
| Кто управляет профилем? | приложение + pnpm | не заменять профиль, делать backup, не трогать чужие плагины |

## 9. Открытые вопросы (не блокируют Phase 1)

1. Точный публичный контракт `agent.inject()` и источник сообщений
   `plugin:<name>` для session format v4 — проверить в Phase 2 по исходникам
   `dsh-session`/`dsh-openwolf`.
2. Создание дочернего агента: **решено через `ctx.subagents.startActivation`**
   (провайдер `spawn`), а не через прямое `ctx.agents.create()`. Открытый
   вопрос — как принудительно ограничить host-tools ребёнка allowlist-ом
   профиля (Phase 2c).
3. Клиентский API dashboard (React-модуль, `dsh.client`) — Phase 7; до этого
   dashboard будет отдельным локальным HTTP-сервисом с токеном.
4. HMR: **проверено** — новый bundle и обновления плагина применяются без
   перезапуска; при ошибке импорта HMR оставляет строку выгруженной, пока
   конфигурация не изменится снова.
5. Серверная синхронизация PostgreSQL/pgvector — Phase 4; локальный режим
   обязан работать без сервера.

## 10. Вывод

Официальный механизм плагинов DSH подтверждён: устанавливаемый npm-пакет,
`dsh.bundle.patch`, Cordis `apply(ctx, config)`, `ctx.tools.register` и
`defineTool`. Для Phase 1 достаточно этих API; никаких изменений в DSH,
никаких выдуманных интерфейсов и никаких native-сборок не требуется.
