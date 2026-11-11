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

### Схема (v1–v7)

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
| `agent_profiles.allowed_tools` | v4 | Явный allowlist инструментов ребёнка |
| `tool_health` | v5 | Health-overlay `(tool_name, action)` для factory_* |
| `tool_health_history` | v5 | История health-проверок |
| `agent_profiles.skills` | v6 | Project-local skill ids профиля |
| `capability_scans` / `capabilities` | v7 | Кэш host capability discovery, TTL 6h |

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
  ├─ registerDispatchTool (ctx.agents scoped runner)
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
`tools` (рекомендуемые имена/glob-паттерны), **`allowed_tools`** (точный
enforcement allowlist), `access_level`, `memory_scope`, `limits`, `enabled`,
`is_builtin`, `version`.

Семь встроенных профилей: DIRECTOR, RESEARCHER, DEVELOPER, SYSADMIN, ANALYST,
EXECUTOR, REVIEWER. `seedBuiltins()` идемпотентен: существующие профили и
пользовательские правки не перезаписываются.

**Scoped tools (Phase 2c).** `allowedTools` — не рекомендация, а enforcement
data. `ctx.agents.create()` получает `setup(agentCtx)`, где
`agentCtx.tools.restrict({deny: known - allowed})` скрывает лишние host-tools,
а глобальный `ctx.tools.guard` проверяет `runtime.toolDenial(childId, name)` и
возвращает `TOOL_NOT_ALLOWED` для любой попытки вне allowlist. Для host-tools
есть отдельный список `HOST_TOOL_NAMES`/aliases (read/write/edit/pwsh/bash,
`run_code`, файловые aliases) и `BROWSER_TOOL_NAMES` (browser_open/click/
screenshot/…): отказ `TOOL_NOT_ALLOWED: host capability <name> ...`;
`run_code` ребёнку не выдаётся.
Allowlist хранится в SQLite и виден в `factory_agent_get/save`.

Встроенные профили имеют явные списки; пользовательский профиль стартует с
пустым allowlist (deny all) и требует явного заполнения. Дочерние профили не
содержат `factory_dispatch`, `factory_review`, `factory_workflow_run` —
оркестрация остаётся у корневого агента.

### 7.1a. Model Router

`ModelRouter` разрешает маршрут дочернего агента:

1. явная модель профиля (`provider`/`model`);
2. модель родителя;
3. `modelFallbacks` (`provider/model` через запятую).

`modelMaxAttempts` (1–3) ограничивает цепочку. `ScopedChildRunner` получает
готовый `agentOptions`; dispatch/review при `stopReason:error` повторяют
следующий route, пишут audit `model.route` и `model.fallback` без prompt/event data.
Fallback подавляется, если в child-сессии уже был успешный `tool/result`
(`successfulTools > 0`): audit `model.fallback_suppressed: tool_side_effect`,
чтобы не повторять side effect. Read-only
`factory_model_route` показывает primary/fallbacks/chain, но не запускает
модель. Route не проверяется по каталогу провайдеров: неверный route вернёт
ошибку child, после чего сработает fallback или задача уйдёт в retry.

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

1. Проверяет профиль, непустой `allowedTools`, `ctx.agents` и родителя.
2. Захватывает READY-задачу (`claim`, lease 30 минут по умолчанию).
3. Собирает prompt: роль и инструкция профиля, задача/цель/план, последние
   записи памяти (как недоверенный справочный контекст).
4. Вызывает `ScopedChildRunner` → `ctx.agents.create()` с
   `setup(agentCtx => agentCtx.tools.restrict(...))`; ребёнок получает
   собственную сессию, cwd проекта, модель профиля (или модель родителя) и
   `allowedTools` в runtime guard **до** первого хода.
5. Ждёт `whenIdle()`, продлевая lease; `completed` → COMPLETED/REVIEW
   (`review=true`), иначе fail с retry/backoff.
6. Освобождает child, allowlist-запись и таймеры в `finally`.

Dispatch синхронный; автоматический цикл DIRECTOR/REVIEWER — следующие фазы.

### 7.5. Dashboard v1

`factory_dashboard` поднимает `node:http`-сервер:

- bind `127.0.0.1`, порт 0 (ephemeral) или заданный;
- `crypto.randomBytes(24)` токен; заголовок `Authorization: Bearer`,
  query или HttpOnly-cookie;
- URL с токеном → 302 на `/` + cookie, токен исчезает из адресной строки;
- только GET; POST → 405; CSP `default-src 'self'`, `no-store`,
  `nosniff`, `frame-ancestors 'none'`;
- без внешних CDN/шрифтов, без мутаций.

Данные `/api/state`: overview, agents, tasks, memory, audit, models, sync,
tools, settings, capabilities. UI на русском, адаптивный, обновление раз в
10 секунд. Вкладки **Модели** (router/fallback/allowlist по профилям) и
**Синхронизация** (configured/auto/pending/failed/cursor) — read-only.
Неподдерживаемые разделы (Workflows/KB/Scheduler/Security/GitHub) показаны как
`plan`, а не имитируются.

### 7.5a. Reviewer

`factory_review` требует задачу в `REVIEW`, выбирает профиль REVIEWER и
запускает **отдельного child-агента** через `ScopedChildRunner` с allowlist
REVIEWER. Ребёнок имеет собственный контекст и только разрешённые read-only
tools, поэтому проверяет артефакты сам. Ответ содержит строку
`VERDICT: PASS|PASS_WITH_WARNINGS|FAIL`, summary и issues.

- PASS / PASS_WITH_WARNINGS → task COMPLETED; executor result сохраняется и
  дополняется блоком `--- REVIEW ---`;
- FAIL → исходная task FAILED + новая READY-задача «Исправить: …» с
  `metadata.fixFor`; после PASS fix исходная переходит в COMPLETED через
  `completeFixed` (event `completed_after_fix`);
- audit `review.*`, child id, fix id; при ошибке child задача остаётся REVIEW.

### 7.5b. Workflow

`factory_workflow_run` — синхронный bounded-цикл:

1. READY → `factory_dispatch(review=true)` → REVIEW;
2. REVIEW → `factory_review`;
3. FAIL → REVIEWER создаёт READY fix-задачу; цикл берёт её;
4. PASS/PASS_WITH_WARNINGS → PASSED;
5. лимит циклов → EXHAUSTED; ошибка child → ERROR/FAILED.

История циклов и audit `workflow.*` сохраняются; после PASS успешной
fix-задачи исходная FAILED-задача тоже становится COMPLETED
(`completed_after_fix`), fix-задача остаётся COMPLETED.

### 7.5c. Autonomous workflow

`autoWorkflowEnabled` (default false) запускает `AutoWorkflowService`:

- создаёт один plugin-owned **coordinator Agent** через `ctx.agents.create`
  (root, без prompt) — он нужен как живой parent для child-агентов;
- таймер раз в `autoWorkflowIntervalSeconds` (мин. 30) находит READY-задачи;
- для каждой запускает bounded `WorkflowService` (`dispatch → review → fix`)
  с `autoWorkflowMaxCycles`, не более `autoWorkflowMaxTasks` за tick;
- audit `auto_workflow.started/tick/failed`;
- `factory_auto_workflow` даёт status/run/start/stop; `run` выполняет один tick
  без включённого таймера;
- `stop()` снимает таймер, ждёт активный tick до `stopTimeoutMs` (5 c), при
  таймауте abort-ит signal и только затем dispose-ит coordinator; audit
  `auto_workflow.stop_timeout`.

Auto workflow не является daemon: живёт только пока загружен плагин.

### 7.5d. Tool Health (v0.18.0)

`ToolHealthService` — overlay над DSH `ctx.tools`, не второй реестр.

- `tool_health` / `tool_health_history` (migration v5) хранят статусы и историю по `(tool, action)`;
- R0 pure probes — `ctx.tools.execute`; R1 — schema/registration (`REGISTERED`, dependenciesChecked false); R2 — `NOT_TESTABLE`;
- `effectiveAllowedTools` фильтрует только `factory_*`; mixed удаляется только при всех `UNAVAILABLE`;
- TTL 10 мин, circuit breaker 3 ошибки/5 мин только для R0;
- host-tools вне health.

### 7.5e. Project Context Isolation (v0.19.0 / BLOCK 2)

`ProjectScopeService` (`plugin/src/projects/policy.ts`) проверяет caller project для
ID-addressed операций. Project id — workspace identity, не пользователь.

- default deny: `PROJECT_MISMATCH`, если task/memory project не равен current;
- task tools/engine: `assertTask` / `requireForProject`;
- memory tools: `assertMemory`; global memory — explicit policy;
- dispatch/review/workflow проверяют task project до claim/child;
- child prompt/audit содержит projectId; DSH session meta 0.2.2 поля projectId не имеет,
  границей остаётся cwd;
- `factory_sync` — global capability, root-only; project-scoped sync — отдельный этап;
- `projectIdOverride` задокументирован и аудируется как `project.override_active`.

### 7.5f. Skill Manager (v0.20.0 / BLOCK 3)

Skills are project-local `.skills/<id>.md` files validated by strict frontmatter.

- `SkillService.resolve(profileId, projectId)` is fail-closed: missing, invalid or disabled skill → `SKILL_NOT_FOUND` before claim/child;
- `SkillStore` is restricted to `<project.rootPath>/.skills`, rejects symlinks/traversal and uses temp+rename with SHA-256 optimistic updates;
- `ScopedChildRunner.setup` registers `factory:profile:<id>` at order 4000 and `factory:skill:<id>` at 6000+priority, all with `interpolate:false`; never `complete:true`;
- authority: Harness → Profile (system) → Skills (system) → Task (user); `composePrompt` carries task data only;
- management tools are root-only; skills never alter `allowedTools`;
- `factory_sync` remains a global capability; managed separately.

### 7.5g. Capability Discovery (v0.21.0 / BLOCK 4)

Host inventory cache, separate from tool health and from tool permissions.

- static allowlist: node, python, java, docker, git, maven, gradle, dotnet, go, rust, npm, pnpm, pip, uv;
- `capabilityScanEnabled=false` and `capabilityProbeMode=off` by default; no automatic scan;
- filesystem/PATH/canonical detection; optional fixed-argv safe probes only when explicitly enabled;
- Docker is presence-only: no `docker --version` / `docker info`;
- SQLite v7 tables `capability_scans` / `capabilities`, TTL 6h, `AVAILABLE`/`UNAVAILABLE`/`STALE`/`UNKNOWN`;
- `factory_capability_check` is cache-only; empty/stale does not auto-scan;
- `requiresCapabilities` on plans/tasks, preflight in Planner and Dispatch before claim/child;
- capability availability never grants `allowedTools`.

### 7.5h. Agent Marketplace (v0.22.0 / BLOCK 5)

- `.agents/<slug>.json` project-local portable profiles; no migration;
- export strips internal `agt_*`, `isBuiltin`, version/timestamps and rejects secrets;
- import validates `allowedTools` subset, access level, project skills and name collision;
- built-ins export as templates; import always creates a new custom profile;
- 3 root-only tools; no child access; files use atomic temp+rename;
- health: 51 factory tools / 59 actions; plugin total 54.

### 7.5i. Backup verification (v0.23.0 / BLOCK 6)

- `scripts/backup.ps1` writes `manifest.json` + `.tar.gz`; table/file hashes.
- `factory_backup_verify` (R0) checks gzip, manifest, tar safety, in-memory SQLite quick_check and table hashes.
- `factory_backup_restore_test` (R1) restores to temp, reports agents/tasks/memory, always cleans up.
- server backups get a sidecar manifest and `X-Backup-Manifest` header.
- 57 plugin tools; health 54 factory tools / 62 actions.

### 7.5j. Crash Recovery (v0.25.0)

- `scripts/watchdog.ps1` monitors DSH, writes `crash-report.json` and restarts up to a limit;
- startup `recoverCrashReport()` creates a DIRECTOR-owned task assigned to built-in REPAIRER;
- reports are redacted, capped and marked handled for idempotency.

### 7.5k. Human feedback

- `factory_task_tell` (R1, root-only) forwards to a registered active child via `followup`;
- non-RUNNING / missing child falls back to `task.metadata.feedback`.

### 7.5l. Natural Language Routing

- DIRECTOR system prompt is an interface contract with few-shot examples;
- DIRECTOR is expected to call memory/task/skill/capability/backup/dashboard tools itself;
  this does not widen `allowedTools`.

### 7.5m. Dashboard UX

- `dashboardAutoStart` (default false) starts the loopback read-only server at plugin startup;
- logs `Панель управления доступна здесь: <url>`; tool output includes a Markdown link;
- DSH 0.2.2-rc.1 exposes no documented host-plugin API for injecting a client button; client event fallback is used.

### 7.5n. Async CONCIERGE (v0.26.0)

- Host listener on `session/event` observes `user/message` while the root agent is RUNNING.
- Status/stop intent is answered by appending a durable `assistant/message` surface event; the queued user copy is removed from the inbox.
- Normal work instructions are not intercepted.
- `agent.inbox`, `Session.append`, `followup` and `steer` are the DSH 0.2.2-rc.1 hooks used; no client-side button API was available.
- Built-in CONCIERGE profile and deterministic listener; 9 built-ins, 57 tools, 141 tests.

### 7.5o. Knowledge Base (v0.27.0)

- project-local `knowledge/`, migration v8 documents/chunks/FTS5;
- extractors: text/markdown/html/json/csv, mammoth DOCX, pdfjs-dist PDF;
- incremental sha256 indexing, no auto scan, path/symlink limits;
- FTS5 BM25 search; `trust: untrusted`; no embeddings yet;
- 4 tools; search/list allowed to DIRECTOR/RESEARCHER/DEVELOPER/REVIEWER;
- 61 plugin tools, 58 factory health tools / 66 actions, schema v8.

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

Сервер `server/` имеет два backend-а за одним `SyncStore`:

- embedded PGlite (PostgreSQL/WASM) для локального режима/тестов;
- standalone PostgreSQL через `pg` и `DATABASE_URL` (pgvector обязателен),
  Docker Compose `pgvector/pgvector:pg16`, healthcheck, volume.

Оба проходят Bearer auth, idempotent `sync_operations`, LWW upsert и conflict.
Backup endpoint/scheduler доступны только PGlite; PostgreSQL backup — `pg_dump`.
TLS reverse proxy/Ubuntu deploy остаются; контракт в `docs/sync-protocol.md`.

### 7.7. Реализовано / ещё нет

| Подсистема | Статус |
|---|---|
| Agent Registry + 7 профилей + CRUD | реализовано и проверено |
| Task Engine: зависимости, lease, retry, recovery, events | реализовано и проверено |
| Planner DAG + `factory_plan_create` | реализовано и проверено |
| DIRECTOR brief + Tool Registry (`factory_tools_list`) | реализовано |
| Реальный дочерний агент через `ctx.agents.create` + setup allowlist | реализовано и проверено live |
| Read-only dashboard на 127.0.0.1 | реализовано |
| Sync client + SQLite outbox + LWW pull | реализовано |
| Sync server: PGlite PostgreSQL + pgvector + HTTP/auth | реализовано и проверено e2e |
| Standalone PostgreSQL adapter (`pg` + `DATABASE_URL`) | реализовано, wire-тест |
| Ubuntu/Docker deploy + TLS proxy | Phase 4b |
| Независимый REVIEWER через child-агент + structured verdict | реализовано |
| Bounded workflow dispatch → review → fix (maxCycles 1–5) | реализовано |
| Bounded autonomous workflow по таймеру | реализовано (default off) |
| Scoped tool restrictions по allowlist профиля | реализовано (Phase 2c) |
| Model Router + fallback + `factory_model_route` | реализовано |
| Workflow-ветвления, фоновый автономный цикл | Phase 3b/6 |
| Dashboard Models/Sync tabs | реализовано |
| Scheduler, GitHub, standalone PostgreSQL/TLS | Phase 4/5/7 |

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
- `factory_dispatch` запускает ребёнка с allowlist; guard стоит на
  `ctx.tools`. Host-возможности вне этого реестра требуют отдельного аудита.
- Task Engine не запускает исполнителей автоматически; dispatch вызывается
  явно. Bounded workflow доступен, фонового autonomous loop нет.
- Dashboard read-only; мутации из UI и Workflows/KB/Scheduler/Security/GitHub —
  позже.
- Dashboard работает, пока жив host-процесс DSH; фонового демона нет.
- Sync server работает на embedded PGlite (single writer); standalone
  PostgreSQL/Ubuntu, TLS proxy и второй ПК не развёрнуты.
- Нет автоматического flush outbox по таймеру; push вызывается инструментом.
- Нет server-side conflict journal/CRDT merge; конфликт возвращается клиенту.
- Нет embeddings/векторного поиска.
- Нет UI; взаимодействие через инструменты и SQLite/CLI-диагностику.
- Нет автоматического brief в промпт; это Phase 2b.
