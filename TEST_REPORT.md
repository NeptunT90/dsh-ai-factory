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
Test Files  13 passed (13)
Tests       50 passed (50)
```

Покрыто: миграции v1→v2→v3, FTS5, память, агенты, Task Engine, Planner,
dispatch fake-service, dashboard auth/read-only, sync outbox/push/pull,
offline/backoff, auth failure, auto-sync timer, reviewer/workflow, tool
contract (34 инструмента).

### Sync server

```
tests 5
pass 5
fail 0
```

Покрыто: pgvector health, idempotent push, pull/cursor, LWW и conflict,
invalid payload, HTTP Bearer auth, backup endpoint (gzip), health.

## 3. Живой DSH

- HMR загрузил AI Factory **v0.8.0**.
- `factory.started`: schema **4**, agents 7, tools **34**.
- SQLite v4: `sync_outbox`, `sync_state`, `sync_apply_guard`, triggers
  `memory_sync_insert/update`.
- Схемы `factory_sync`, `factory_review`, `factory_workflow_run` доставлены в
  Web GUI-сессию.
- 27 прежних плагинов сохранены; `doctor.ps1` проходит.

### Live smoke v0.7.0

Вызовы сделаны из Web GUI через реальные инструменты:

- `factory_status` → 0.8.0, schema 4, 7 агентов, 34 инструмента.
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

Live v0.7.0: `factory_dashboard start`, открыт URL с одноразовым токеном,
редирект на HttpOnly-cookie. Панель показала 2 задачи, 1 память и audit
`review.*`; screenshot:
[docs/assets/dashboard-live-v0.7.0.png](docs/assets/dashboard-live-v0.7.0.png).
Read-only auth/405 проверены автотестами.

## 6. Release / portability

- `dist/dsh-ai-factory-0.8.0.tgz`: **137 654 байт**.
- SHA256: `5cab59cfef9a14a4be0932667c2541dcbe087af3469a15ece8707a07c47dd15b`.
- `verify-package.ps1`: обязательные файлы есть, `node_modules` нет.
- `portable-test` обновлён с 0.7.1 на 0.8.0; schema 4, 34 инструмента.
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
- Model Router и фоновый автономный цикл не реализованы; scoped allowlist закрыт.
- Физически второй ПК не проверялся.
- Полный restart DSH после 0.8.0 не выполнен.

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
