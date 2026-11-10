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
Tests       56 passed (56)
```

Покрыто: миграции v1→v2→v3, FTS5, память, агенты, Task Engine, Planner,
dispatch fake-service, dashboard auth/read-only, sync outbox/push/pull,
offline/backoff, auth failure, auto-sync timer, reviewer/workflow, tool
contract (36 инструментов).

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

- HMR загрузил AI Factory **v0.16.0**.
- `factory.started`: schema **4**, agents 7, tools **35**.
- SQLite v4: `sync_outbox`, `sync_state`, `sync_apply_guard`, triggers
  `memory_sync_insert/update`.
- Схемы `factory_sync`, `factory_review`, `factory_workflow_run` доставлены в
  Web GUI-сессию.
- 27 прежних плагинов сохранены; `doctor.ps1` проходит.

### Live smoke v0.7.0

Вызовы сделаны из Web GUI через реальные инструменты:

- `factory_status` → 0.16.0, schema 4, 8 профилей, 36 инструментов.
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

### Auto workflow tool v0.16.0 (live)

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

- Схема **v4**, `agent_profiles.allowed_tools`; 7 профилей имеют явные списки.
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

- `dist/dsh-ai-factory-0.16.0.tgz`: **149 113 байт**.
- SHA256: `c4002271f6eb7151c18474ad9a9426157316a7b29c16b09e45ee4657d85102d4`.
- Серверный архив: `dist/dsh-ai-factory-sync-server-0.17.0.tgz` — 17 189 байт,
  SHA256 `8195dd3bedb33fc527889023428d94abc1890d10949d9e0b48bbd8f22777a6c5`;
  распаковка проверена, `dist/index.js` и `scripts/restore.mjs` на месте.

### Clean-room server install

- Архив распакован в пустой каталог, `npm install --omit=dev`: 16 packages.
- Сервер запущен на 127.0.0.1:8799 с PGlite.
- `/health`: `vector:true`.
- `POST /v1/sync/push` → accepted; `GET /v1/sync/pull` → change;
  `memories:1`, `operations:1`.
- Процесс остановлен; исходники/workspace node_modules не использовались.
- `verify-package.ps1`: обязательные файлы есть, `node_modules` нет.
- `portable-test` обновлён с 0.15.0 на 0.16.0; schema 4, 36 инструментов.
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
- Полный restart DSH после 0.16.0 не выполнен.

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
