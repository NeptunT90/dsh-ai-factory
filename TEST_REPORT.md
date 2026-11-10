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
Test Files  11 passed (11)
Tests       41 passed (41)
```

Покрыто: миграции v1→v2→v3, FTS5, память, агенты, Task Engine, Planner,
dispatch fake-service, dashboard auth/read-only, sync outbox/push/pull,
offline/backoff, auth failure, auto-sync timer, tool contract (33 инструмента).

### Sync server

```
tests 5
pass 5
fail 0
```

Покрыто: pgvector health, idempotent push, pull/cursor, LWW и conflict,
invalid payload, HTTP Bearer auth, backup endpoint (gzip), health.

## 3. Живой DSH

- HMR загрузил AI Factory **v0.6.0**.
- `factory.started`: schema **3**, agents 7, tools **33**.
- SQLite v3: `sync_outbox`, `sync_state`, `sync_apply_guard`, triggers
  `memory_sync_insert/update`.
- Схема `factory_sync` доставлена в Web GUI-сессию.
- 27 прежних плагинов сохранены; `doctor.ps1` проходит.

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

Браузерная проверка выполнена на demo-runtime (v0.4.0); UI не менялся.
Проверены Overview/Agents/Tasks/Settings; screenshot:
[docs/assets/dashboard-overview.png](docs/assets/dashboard-overview.png).
Read-only auth/405 проверены автотестами.

## 6. Release / portability

- `dist/dsh-ai-factory-0.6.0.tgz`: **128 486 байт**.
- SHA256: `de4982770a83f00f121a26bb992136434d0b42ca75b5e3f71e003d94ea949b64`.
- `verify-package.ps1`: обязательные файлы есть, `node_modules` нет.
- `portable-test` обновлён с 0.5.0 на 0.6.0; schema 3, 33 инструмента.
- Release workflow на тег `v*`; GitHub Release не создан (нет remote).
- Sync server имеет Dockerfile/Compose.

## 7. Ограничения / не проверено

- Standalone PostgreSQL/Ubuntu + TLS reverse proxy не развёрнуты; используется
  embedded PGlite, single writer.
- Нет автоматического планировщика backup/restore и multi-writer; backup
  endpoint/скрипт запускаются вручную.
- Нет автоматического flush outbox по таймеру.
- Live tool-calls из модели в Web GUI не выполнены (текущий клиент не
  инициирует tool-call; схемы доставлены).
- Scoped tool allowlist, Model Router и автоматический fix → re-review не реализованы.
- Физически второй ПК не проверялся.
- Полный restart DSH после 0.6.0 не выполнен.

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
