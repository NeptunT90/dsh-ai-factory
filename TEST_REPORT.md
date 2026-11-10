# TEST_REPORT

Дата: 2026-11-10  
Платформа: Windows 11 x64, Node 22.22.3 (dev), DSH Desktop 0.2.2-rc.1 (Electron 44.7.0, Node 24.21.0)

## 1. Статические проверки

| Проверка | Команда | Результат |
|---|---|---|
| Plugin TypeScript | `pnpm typecheck` | PASS |
| Server TypeScript | `pnpm server:typecheck` | PASS |
| Сборка плагина | `pnpm build` | PASS |
| Сборка сервера | `pnpm server:build` | PASS |
| Манифесты/BOM | JSON/YAML/TS без BOM, `.ps1` с BOM | PASS |

## 2. Автотесты

### Plugin

```
Test Files  15 passed (15)
Tests       76 passed (76)
```

Покрыто: миграции v1→v2→v3, FTS5, память, агенты, Task Engine, Planner,
dispatch fake-service, dashboard auth/read-only, sync outbox/push/pull,
offline/backoff, auth failure, auto-sync timer, reviewer/workflow, tool
contract (39 инструментов).

### Sync server

```
tests 10
pass 10
fail 0
```

Покрыто: pgvector health, idempotent push, pull/cursor, LWW и conflict,
invalid payload, HTTP Bearer auth, backup endpoint (gzip), dump→restore,
scheduled backup rotation, PgStore over PostgreSQL wire protocol, direct HTTPS/TLS, multi-writer idempotency, health.

Restore CLI проверен на реальном backup:
`memories:1`, `operations:2`, `vector:true`; непустой target отклоняется.

Standalone PostgreSQL adapter проверен через PGlite socket (pg wire):
push/pull/idempotency/health, `vector:true`. Два PgStore-писателя
принимают один opId ровно один раз. Direct HTTPS проверен с self-signed cert
(openssl). Docker Compose не запускался — Docker нет.

## 3. Живой DSH

- HMR загрузил AI Factory **v0.18.0**.
- `factory.started`: schema **4**, agents 7, tools **35**.
- SQLite v5: `tool_health`/`tool_health_history`; также v3 `sync_outbox`/`sync_state`/`sync_apply_guard`/triggers
  `memory_sync_insert/update`.
- Схемы `factory_sync`, `factory_review`, `factory_workflow_run` доставлены в
  Web GUI-сессию.
- 27 прежних плагинов сохранены; `doctor.ps1` проходит.

### Live smoke v0.7.0

Вызовы сделаны из Web GUI через реальные инструменты:

- `factory_status` → 0.18.0, schema 5, 10 профилей (7 builtin + 3 test), 39 инструментов.
- `factory_memory_remember` → `mem_b0e45f25…`, затем FTS5-поиск нашёл запись.
- `factory_dispatch` задачи `tsk_a2e5f83e…` → child
  `0adb4aa8…` (`agt_executor`), `completed`, ответ **PONG**, задача COMPLETED.
- `factory_review` задачи `tsk_4336caca…` → child `fa6e4cad…`,
  structured **PASS**, задача COMPLETED, fix не создавался.
- `factory_workflow_run` задачи `tsk_28c73300…` → **PASSED** за 1 цикл,
  задача COMPLETED.
- Полный live-цикл: `tsk_6375418b…` FAIL → fix `tsk_ecefb80a…` → PASS,
  workflow PASSED за 2 цикла.
- Найден дефект: PASS перезаписывал executor result; исправлено в 0.7.1
  (исходный result + `--- REVIEW ---`).
- Dashboard открыт в браузере: 2 задачи, 1 память, audit `review.*`.

Подробно: [docs/LIVE_SMOKE.md](docs/LIVE_SMOKE.md).

### Project Context Isolation v0.19.0 (live)

- HMR loaded **0.19.0**; schema v5, 39 tools.
- Two live projects A (`C:\AI Factory`) and B (`C:\AI Factory\.research\project-b-live`).
- B task/memory seeded; calling `factory_task_get`, `factory_memory_get` from A →
  `PROJECT_MISMATCH`; `factory_dispatch` and `factory_workflow_run` rejected before claim/child.
- Dashboard with `projectId=B`: `tasks=1`, `memory=1`, only B rows; overview projectFilter=B.
- 76 plugin tests (9 project-isolation scenarios); server 10/10.

### Tool Health Check v0.18.0 (live)

- Migration v5 applied live; `factory_status` HEALTHY 1–2 ms through
  `ctx.tools.execute`.
- `factory_tool_health`: 36 factory tools; R1 `REGISTERED` source=schema
  dependenciesChecked=false; R2 `NOT_TESTABLE`.
- `factory_tool_health_check` full sweep: 44 action checks; 11 HEALTHY,
  16 REGISTERED, 3 NOT_TESTABLE, 6 UNKNOWN; dangerous actions not called.
- Mixed `factory_sync`: status HEALTHY, push/pull/sync NOT_TESTABLE
  (aggregate HEALTHY, tool kept).
- `factory_tool_health_history` returns rows; dashboard Tool Registry
  includes status/risk/checked/latency.

### Browser and factory-sync boundaries (v0.17.0)

- NOFILE (`allowedTools: ["factory_status"]`) → `browser_open` → `unknown
  tool`; browser-* не смонтированы. Unit guard покрывает
  `browser_open/click/screenshot` → `TOOL_NOT_ALLOWED: host capability ...`.
- SYNCONLY (`factory_sync`+`factory_status`) → `factory_sync status` работает;
  `read` недоступен, файл не прочитан. `factory_sync` имеет только action и
  читает/пишет память/БД, не произвольный путь; `factory_dashboard` — только
  action/port.
- Desktop live sync: локальный сервер :8788, token через существующий env
  `USERNAME` (DSH process нельзя добавить env без restart), `syncUrl` задан,
  `factory_sync action=sync` → accepted 2, cursor 2; remote memory через
  `push` → `factory_sync action=pull` → applied 1, cursor 3; health
  `memories:3`, `operations:3`. Конфиг восстановлен, сервер остановлен.

### Four internal debts v0.17.0

- **Host capabilities:** NOFILE `read` → `unknown tool "read"`; READONLY
  `write` → `TOOL_NOT_ALLOWED: write ...`; RESEARCHER `read` →
  `unknown tool "read"`. Прямого обхода read/write/pwsh не воспроизведено;
  добавлен `HOST_TOOL_NAMES`/aliases guard и тест `RESEARCHER` host denial.
- **Auto stop:** тест stop во время зависшего tick: timeout 50 мс, abort,
  coordinator dispose, без ошибок.
- **Fallback side effect:** тест child error с `successfulTools=1` → fallback
  не вызывается, audit `model.fallback_suppressed`.
- **FAIL → fix → PASS:** тест подтверждает исходную COMPLETED
  (`completed_after_fix`) и fix COMPLETED.

### Auto workflow tool v0.17.0 (live)

- `factory_auto_workflow status`: enabled=false, timer=false.
- Создана READY-задача `tsk_eda508af…`; `factory_auto_workflow run` →
  **PASSED**, 1 цикл, задача COMPLETED.
- Конфиг fallback восстановлен после теста.
### Autonomous workflow v0.15.0 (live)

- Создана READY-задача `tsk_aee61490…`; включены autoWorkflow*, interval 30s,
  maxCycles=1, maxTasks=1, fallback deepseek-flash.
- Tick сработал: `workflow.started` → child PONG → REVIEW PASS →
  `workflow.passed` / `auto_workflow.tick`; задача COMPLETED.
- Конфиг восстановлен, auto выключен; default — false.
- MaxCycles/maxTasks ограничены.

### Scoped allowlist v0.8.0 (live)

- Схема **v5**, `agent_profiles.allowed_tools` + `tool_health`/history; 7 профилей имеют явные списки.
- RESEARCHER-задача `tsk_84b3e2c0…`, child `ses_a7143044…`:
  `factory_memory_forget` → `TOOL_NOT_ALLOWED: factory_memory_forget не входит
  в allowlist профиля ребёнка`; запись памяти осталась активной.
- Scoped REVIEWER `tsk_7804a5a0…` → `VERDICT: PASS`, COMPLETED.
- DEVELOPER child `ses_ef302b7a…` попытался `factory_dispatch` →
  `Error: TOOL_NOT_ALLOWED: factory_dispatch не входит в allowlist профиля
  ребёнка`; внук не создан.
- Scoped workflow `tsk_fd7a9724…` → PASSED, 1 цикл.
- 4 allowlist-теста + live-проверка; всего **50** plugin-тестов.

### Model Router v0.9.0 (live)

- **Fallback live:** временный профиль BADROUTE с моделью
  `deepseek-official/this-model-does-not-exist-xyz`; dispatch упал на первом
  child и повторился на `deepseek-official/deepseek-flash`; задача COMPLETED.
  Audit `model.route` содержит цепочку, `model.fallback` — переход.
- `factory_model_route` для DEVELOPER/REVIEWER → deepseek-flash.
- В 0.10.1 диагностика fallback санитизирована: без event data/system prompt.

### Reviewer / workflow

- 3 reviewer-теста: structured PASS, FAIL + fix-задача, отсутствие subagents.
- 3 workflow-теста: FAIL → fix → PASS, EXHAUSTED при maxCycles, ERROR без
  subagents.
- `factory_dispatch review=true` проверен отдельно.

## 4. End-to-end sync

Запущен `server/dist/index.js` на PGlite с `SYNC_TOKEN`, отдельный data-dir.

```
GET /health
{"ok":true,"vector":true,"memories":0,"operations":0,
 "service":"dsh-ai-factory-sync","protocol":1}
```

Сценарий:

1. Runtime A (SQLite A) remember → outbox 1.
2. `factory_sync.push` → accepted 1, pending 0.
3. Runtime B (SQLite B) pull → applied 1; запись в B, обратного outbox 0.
4. A update → push; B pull → version 2, content обновлён.
5. `/health`: `memories:1`, `operations:2`, `vector:true`.
6. Backup endpoint вернул gzip; `scripts/server-backup.ps1` скачал
   `sync-backup-test.tar.gz` (4 856 650 байт, magic `1F8B`, SHA256) — сервер
   остановлен и запущен снова на том же `SYNC_DB_DIR`; `/health`
   подтвердил `memories:1`, `operations:2` — данные пережили restart.

Это реальный HTTP-обмен между двумя SQLite через PostgreSQL-совместимый
сервер с pgvector, не mock.

## 5. Dashboard

Live v0.10.0: открыты вкладки **Модели** и **Синхронизация**.
Модели: router ON, attempts 2, все профили inherit; allowlist 16–32 tools.
Sync: configured=false, pending=1, failed=0, auto=OFF, token=no.
Скриншот: [docs/assets/dashboard-models-sync-v0.10.0.png](docs/assets/dashboard-models-sync-v0.10.0.png).

Live v0.7.0: `factory_dashboard start`, открыт URL с одноразовым токеном,
редирект на HttpOnly-cookie. Панель показала 2 задачи, 1 память и audit
`review.*`; screenshot:
[docs/assets/dashboard-live-v0.7.0.png](docs/assets/dashboard-live-v0.7.0.png).
Read-only auth/405 проверены автотестами.

## 6. Release / portability

- `dist/dsh-ai-factory-0.19.0.tgz`: **173 562 байт**.
- SHA256: `18ded1576062a6df616986d352f5c7c516bf00f54ebe5041556facd577dc06c8`.
- Серверный архив: `dist/dsh-ai-factory-sync-server-0.17.0.tgz` — 17 189 байт,
  SHA256 `8195dd3bedb33fc527889023428d94abc1890d10949d9e0b48bbd8f22777a6c5`;
  распаковка проверена, `dist/index.js` и `scripts/restore.mjs` на месте.
- Release notes: `dist/RELEASE_NOTES-v0.20.0.md` (1 732 байт), генерируются
  из CHANGELOG/SHA256SUMS.

### Clean-room server install

- Архив распакован в пустой каталог, `npm install --omit=dev`: 16 packages.
- Сервер запущен на 127.0.0.1:8799 с PGlite.
- `/health`: `vector:true`.
- `POST /v1/sync/push` → accepted; `GET /v1/sync/pull` → change;
  `memories:1`, `operations:1`.
- Процесс остановлен; исходники/workspace node_modules не использовались.
- `verify-package.ps1`: обязательные файлы есть, `node_modules` нет.
- `portable-test` обновлён с 0.15.0 на 0.19.0; schema 5, 39 инструментов.
- Release workflow на тег `v*`; GitHub Release не создан (нет remote).
- Sync server имеет Dockerfile/Compose.

## 7. Ограничения / не проверено

- Standalone PostgreSQL/Ubuntu + TLS reverse proxy не развёрнуты; используется
  embedded PGlite, single writer.
- Нет автоматического планировщика backup/restore и multi-writer; backup
  endpoint/скрипт запускаются вручную.
- Auto-sync реализован; live-сервер к desktop-профилю не подключался.
- `factory_workflow_run` live полностью проверен: REVIEW→PASS и
  FAIL→fix→PASS.
- Фоновый автономный цикл реализован bounded (autoWorkflow*, default off); standalone PostgreSQL/TLS реализованы, deploy не выполнен.
- Физически второй ПК не проверялся.
- Полный restart DSH после 0.19.0 не выполнен.

## 8. Повтор

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm server:typecheck
pnpm server:test
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/doctor.ps1 -Profile desktop
```

Sync server:

```powershell
$env:SYNC_TOKEN = "dev-token"
$env:SYNC_DB_DIR = "$PWD\.research\sync-server-data"
node server\dist\index.js
```
