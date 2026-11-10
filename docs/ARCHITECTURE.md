# Архитектура DSH AI Factory

## 1. Принципы

1. **Плагин, а не форк DSH.** Всё работает через официальный Cordis plugin API
   и `ctx.tools`; исходники приложения не изменяются.
2. **Реальные данные и реальные вызовы.** Никаких «имитаций» задач: память
   лежит в SQLite, инструменты выполняются в host-процессе, результаты
   проверяются тестами.
3. **Строгие границы.** Каждый модуль имеет узкий интерфейс; прямые зависимости
   «всё со всем» запрещены. Память не знает о UI; инструменты не ходят в БД
   напрямую.
4. **Локальный режим — основной.** Сервер (Phase 4) опционален; его
   недоступность не блокирует работу.
5. **Безопасность по умолчанию.** Секреты не сохраняются, внешние данные
   помечаются как недоверенные, опасные операции требуют отдельной политики.
6. **Переносимость.** Никаких абсолютных путей в коде, никакой привязки к
   одному ПК. Данные и конфигурация разделены.

## 2. Слои Phase 1

```
┌─────────────────────────────────────────────────────────────┐
│ DSH Cordis Host                                             │
│  ctx.tools  ctx.logger  ctx.effect                          │
└───────────────────────┬─────────────────────────────────────┘
                        │ apply(ctx, config)
┌───────────────────────▼─────────────────────────────────────┐
│ plugin/src/index.ts                                         │
│  lifecycle, startup error containment, tool registration    │
└───────┬───────────────────────────────┬─────────────────────┘
        │                               │
┌───────▼──────────────┐       ┌────────▼────────────────────┐
│ tools/status.ts      │       │ memory/tools.ts             │
│ factory_status       │       │ 7 memory tools              │
└───────┬──────────────┘       └────────┬────────────────────┘
        │                               │
        └──────────────┬────────────────┘
                       │ typed calls
┌──────────────────────▼─────────────────────────────────────┐
│ runtime.ts — composition root                              │
│  config → FactoryDatabase → ProjectService / AuditLog      │
│  MemoryEngine (единственный владелец SQL памяти)           │
└──────────────────────┬─────────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────────┐
│ storage/database.ts + migrations.ts                        │
│  node:sqlite, WAL, FTS5, user_version migrations           │
└────────────────────────────────────────────────────────────┘
```

Правила зависимостей:

- `memory/tools.ts` зависит от `runtime`, `memory/types`, `core/errors`.
- `memory/engine.ts` зависит от `FactoryDatabase`, `ProjectService`,
  `ResolvedConfig`, `core/*`. Он не импортирует Cordis и не знает про DSH.
- `runtime.ts` — единственная точка сборки сервисов.
- `index.ts` — единственная точка, где вызывается Cordis API.
- `core/security.ts` не зависит ни от чего, кроме `FactoryError`.

Такое разделение позволяет тестировать движок без DSH и позже вынести его в
отдельный пакет/сервер.

## 3. Хранилище

### SQLite

- Драйвер: встроенный `node:sqlite` (Node 24), без native-сборки.
- Файл: `<dataDir>/factory.db`; WAL, `synchronous=NORMAL`,
  `foreign_keys=ON`, `busy_timeout=5000`.
- Миграции: упорядоченный массив SQL, транзакция + `PRAGMA user_version`.
- Соединение синхронное; все операции одного процесса сериализованы. Для
  будущего фонового scheduler этого достаточно, пока один writer.

### Схема (v1 + v2)

| Таблица | Версия | Назначение |
|---|---|---|
| `projects` | v1 | Проект: стабильный id, canonical path, имя |
| `memory_entries` | v1 | Записи памяти, trust, версии, TTL, soft delete |
| `memory_versions` | v1 | Снимок состояния до изменения |
| `memory_fts` | v1 | FTS5-индекс (title, content, tags) |
| `audit_log` | v1 | Аудит действий и жизненного цикла |
| `settings` | v1 | Зарезервировано для настроек |
| `agent_profiles` | v2 | Durable-профили специалистов и лимиты |
| `tasks` | v2 | Очередь задач, зависимости, lease, retry |
| `task_events` | v2 | История переходов задачи |
| `sync_outbox` | v3 | Идемпотентные операции памяти для сервера |
| `sync_state` | v3 | deviceId и cursor |
| `sync_apply_guard` | v3 | Подавление outbox при pull |
| `memory_sync_insert/update` | v3 | Триггеры автоматического outbox |

Ключевые инварианты:

- `scope='project'` требует `project_id`; `scope='global'` — нет.
- Уникальный частичный индекс `(ifnull(project_id,''), kind, content_hash)
  WHERE status='active'` защищает от дублей.
- `version` монотонно растёт; перед изменением старый снимок пишется в
  `memory_versions`.
- Удаление — только soft delete; физическая очистка появится отдельной
  административной операцией с подтверждением.
- FTS-триггеры синхронизируют индекс при вставке, удалении и изменении
  title/content/tags.

### Типы памяти

| Тип | Что хранит | Область по умолчанию |
|---|---|---|
| `working` | Текущая задача, промежуточный результат | project |
| `episodic` | Событие, решение, ошибка, исправление | project |
| `semantic` | Факт, знание, документация | project |
| `project` | Архитектура, состояние, зависимости | project |
| `user` | Предпочтения и правила пользователя | global |

`trust`: `verified`, `user_confirmed`, `unverified`, `inferred`. Внешний
импорт и ответы инструментов по умолчанию `unverified`; предположение не
превращается в факт автоматически.

## 4. Поиск

Phase 1 использует FTS5/BM25:

- запрос нормализуется, токены превращаются в prefix-запросы;
- при ошибке FTS или неподходящем запросе — безопасный `LIKE` fallback;
- результаты фильтруются по проекту, области, типу, тегам, confidence и TTL;
- сниппет строится FTS5 `snippet()`.

**Семантический поиск не имитируется.** Интерфейс `search` расширяемый; в
Phase 4 добавляется векторный индекс (pgvector) и embeddings, с явным
указанием, когда использован лексический, а когда векторный поиск.

## 5. Безопасность

- **Секреты.** Регулярные выражения для private keys, GitHub/OpenAI/AWS/Slack
  токенов, JWT и `password=...`. При обнаружении — `SECRET_DETECTED`, запись
  отклоняется. Плейсхолдеры (`<your-key>`, `${API_KEY}`) разрешены.
- **Prompt injection.** Текст с маркерами («ignore previous instructions» и
  т.п.) сохраняется с `trustWarning` в metadata; это данные, а не команды.
  Авторизация от этого не меняется.
- **Аудит.** Пишутся id, тип, результат, длина запроса; не текст памяти и не
  секреты. Ошибка аудита не ломает пользовательскую операцию.
- **Приватность.** Каталог данных по умолчанию `0700` на POSIX; в Windows
  наследуются ACL профиля пользователя. Плагин не публикует сетевых портов в
  Phase 1.
- **Границы.** Инструменты работают только с локальной БД и не выполняют
  команды/сетевые запросы. Будущие опасные инструменты обязаны проходить через
  Security Manager и approval-политику DSH.

## 6. Жизненный цикл

```
apply(ctx, config)
  ├─ config.enabled? ── нет → лог, выход
  ├─ FactoryRuntime.create
  │    ├─ resolveConfig / mkdir
  │    ├─ FactoryDatabase (миграции v1→v2)
  │    ├─ ProjectService / AuditLog / MemoryEngine
  │    ├─ AgentRegistry.seedBuiltins()
  │    ├─ TaskEngine + PlannerService
  │    ├─ expire просроченной памяти
  │    └─ recoverStale() для задач с истёкшим lease
  ├─ registerStatusTool (всегда)
  ├─ registerMemoryTools / AgentTools / TaskTools / OrchestrationTools
  ├─ registerDispatchTool (ctx.subagents, optional)
  ├─ registerDashboardTool (loopback HTTP, opt-in)
  └─ ctx.effect(async () => stop dashboard → dispose tools → close DB)
```

Ошибка запуска не валит DSH: `factory_status` остаётся доступным и показывает
`status:error` с причиной. Ошибка отдельного инструмента возвращается как
штатная ошибка tool-call.

## 7. Agent Registry и Task Engine

### 7.1. Agent Registry

Таблица `agent_profiles` хранит durable-профили:
`role`, `title`, `system_instruction`, `model_provider/model`,
`tools` (рекомендуемые имена/glob-паттерны), `access_level`,
`memory_scope`, `limits`, `enabled`, `is_builtin`, `version`.

Семь встроенных профилей: DIRECTOR, RESEARCHER, DEVELOPER, SYSADMIN, ANALYST,
EXECUTOR, REVIEWER. `seedBuiltins()` идемпотентен: существующие профили и
пользовательские правки не перезаписываются.

**Важно:** профиль — это конфигурация роли, а не запущенный LLM-агент.
Фактическое создание дочернего агента через `ctx.agents.create()` и передача
ему scoped-инструментов — Phase 2b. До этого `tools` — рекомендации для
будущего ограничения, а не enforcement.

### 7.2. Task Engine

`tasks` — durable очередь. Поля: проект, родитель, цель, статус, приоритет,
исполнитель/роль, план, зависимости, срок, `attempts/max_attempts`,
`available_at`, `lease_owner/lease_until`, результат/ошибка, версия.

Статусы: `NEW → PLANNING → READY → RUNNING → WAITING/REVIEW → COMPLETED`,
а также `FAILED`, `CANCELLED`. Ключевые инварианты:

- `claim` атомарен: READY, все зависимости COMPLETED, лимит параллельных
  задач агента не превышен; lease и attempt выдаются в одной транзакции.
- `complete` освобождает lease и переводит зависимые WAITING → READY.
- `fail` делает retry с экспоненциальным backoff, пока есть попытки; иначе
  FAILED. Ручной `retry` расширяет бюджет на одну попытку.
- `recoverStale` на старте находит RUNNING с истёкшим lease и возвращает их в
  READY/FAILED. Это реальное восстановление после падения, а не имитация.
- `task_events` хранит аудит переходов.

### 7.3. Planner / DIRECTOR

`factory_plan_create` принимает цель и шаги; Planner проверяет уникальность
ключей, DAG и циклы, топологически создаёт родителя и дочерние задачи,
назначает профили по ролям. Зависимости становятся id задач.

`factory_director_brief` — не автономный LLM-цикл, а фактический снимок
состояния: агенты, статистика задач, открытые задачи, последние записи памяти
и детерминированные next actions. Решение и вызовы инструментов остаются за
главной моделью.

### 7.4. Dispatch дочернего агента

`factory_dispatch` — синхронный исполнитель:

1. Проверяет профиль, `ctx.subagents` и родительского Agent.
2. Захватывает READY-задачу (`claim`, lease 30 минут по умолчанию).
3. Собирает prompt: роль и инструкция профиля, задача/цель/план, последние
   записи памяти (как недоверенный справочный контекст).
4. Вызывает официальный `ctx.subagents.startActivation({provider:'spawn',
   delivery:'caller'})`; ребёнок получает собственную сессию, cwd проекта и
   `agentOptions` модели профиля (если provider+model заданы).
5. Ждёт `activation.result`, продлевая lease; `stopReason:'completed'` →
   задача COMPLETED с output; иначе fail с retry/backoff.
6. Освобождает активацию и таймеры в `finally`.

Инструменты профиля пока **не enforced**: spawn наследует composition
родителя; allowlist — Phase 2c. Dispatch синхронный; автоматический цикл
DIRECTOR/REVIEWER — следующие фазы.

### 7.5. Dashboard v1

`factory_dashboard` поднимает `node:http`-сервер:

- bind `127.0.0.1`, порт 0 (ephemeral) или заданный;
- `crypto.randomBytes(24)` токен; заголовок `Authorization: Bearer`,
  query или HttpOnly-cookie;
- URL с токеном → 302 на `/` + cookie, токен исчезает из адресной строки;
- только GET; POST → 405; CSP `default-src 'self'`, `no-store`,
  `nosniff`, `frame-ancestors 'none'`;
- без внешних CDN/шрифтов, без мутаций.

Данные `/api/state`: overview, agents, tasks, memory, audit, tools, settings,
capabilities. UI на русском, адаптивный, обновление раз в 10 секунд.
Неподдерживаемые разделы (Workflows/KB/Models/Scheduler/Security/Server/
GitHub) показаны как `plan`, а не имитируются.

### 7.6. Sync client / outbox

SQLite triggers `memory_sync_insert`/`memory_sync_update` пишут в
`sync_outbox` каждую реальную версию памяти (не access_count). Payload —
`json_object(...)` с project name/root, полями memory и `updatedAt`.

`SyncService`:

- `push` — батч операций с `opId`/`baseVersion`; Bearer-токен из env;
  accepted → `sent_at`, ошибки → attempts/backoff;
- `pull` — `since=cursor`, применяет payload через `MemoryEngine.applyRemote`;
- `applyRemote` — LWW по `updatedAt`, импорт/remap проекта, guard-таблица
  подавляет обратный outbox, FTS-триггеры обновляют индекс;
- URL: HTTPS или loopback HTTP; HTTP на внешний host отклоняется;
- сетевой сбой не удаляет операцию; локальный режим работает без сервера.

Production PostgreSQL/pgvector-сервер ещё не реализован; контракт и mock-
сервер описаны в `docs/sync-protocol.md`.

### 7.7. Реализовано / ещё нет

| Подсистема | Статус |
|---|---|
| Agent Registry + 7 профилей + CRUD | реализовано и проверено |
| Task Engine: зависимости, lease, retry, recovery, events | реализовано и проверено |
| Planner DAG + `factory_plan_create` | реализовано и проверено |
| DIRECTOR brief + Tool Registry (`factory_tools_list`) | реализовано |
| Реальный дочерний агент через `ctx.subagents` (`factory_dispatch`) | реализовано |
| Read-only dashboard на 127.0.0.1 | реализовано |
| Sync client + SQLite outbox + LWW pull | реализовано и проверено mock-сервером |
| PostgreSQL/pgvector sync server | Phase 4b, ожидает сервер |
| Scoped tool restrictions по allowlist профиля | Phase 2c |
| Model Router, workflow-ветвления, автоматический REVIEWER-цикл | Phase 3b/6 |
| Scheduler, server sync, GitHub | Phase 4/5/7 |

| Будущая подсистема | Точка интеграции |
|---|---|
| Reviewer | отдельный агент + правила приёмки |
| Workflow | граф шагов над Task Engine |
| Scheduler | `ctx.effect` + таймеры, только пока процесс жив |
| Dashboard v2 | мутации, client-plugin, остальные разделы |
| Server sync | outbox + REST + pgvector |
| GitHub | `git`/API через Tool Registry |
| Plugin Creator | отдельный контролируемый модуль |

## 8. Принятые решения

1. **Свой SQLite вместо `ctx.storageDomain`** — требуется FTS5, версии,
   транзакции и переносимость; официальный storage остаётся доступным как
   альтернативный адаптер, но не является обязательным.
2. **`node:sqlite` вместо `better-sqlite3`** — нет native-сборки под ABI
   Electron; проверено в реальном DSH.
3. **ESM + строгий TypeScript** — соответствует Cordis/DSH.
4. **Память привязана к canonical path** — предсказуемо для локального
   проекта; `projectIdOverride` решает перенос.
5. **Status tool всегда** — диагностика не должна зависеть от успешного
   старта БД.
6. **Никаких tools для shell/SSH в Phase 1** — сначала фундамент и
   безопасность; опасные инструменты появятся с политикой approvals.

## 9. Ограничения текущей фазы

- Один процесс-писатель; межпроцессная синхронизация не реализована.
- Нет фонового scheduler; TTL и recovery запускаются при старте и явно.
- `factory_dispatch` реально запускает ребёнка, но host-tools не ограничены
  allowlist-ом профиля; это Phase 2c.
- Task Engine не запускает исполнителей автоматически; dispatch вызывается
  явно, полный DIRECTOR/REVIEWER-цикл — Phase 3b+.
- Dashboard v1 read-only; мутации из UI и остальные разделы — позже.
- Dashboard работает, пока жив host-процесс DSH; фонового демона нет.
- Sync server отсутствует: клиент/outbox проверены mock-сервером, но реальная
  PostgreSQL/pgvector-синхронизация и второй ПК не развёрнуты.
- Нет автоматического flush outbox по таймеру; push вызывается инструментом.
- Нет embeddings/векторного поиска.
- Нет UI; взаимодействие через инструменты и SQLite/CLI-диагностику.
- Нет автоматического brief в промпт; это Phase 2b.
