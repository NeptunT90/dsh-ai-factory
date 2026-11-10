# TEST_REPORT

Дата: 2026-11-10  
Платформа: Windows 11 x64, Node 22.22.3 (dev), DSH Desktop 0.2.2-rc.1 (Electron 44.7.0, Node 24.21.0)

## 1. Статические проверки

| Проверка | Команда | Результат |
|---|---|---|
| TypeScript strict | `pnpm --filter dsh-ai-factory typecheck` | PASS |
| Сборка | `pnpm --filter dsh-ai-factory build` | PASS |
| Манифесты | `package.json`, `dsh.bundle.patch` | PASS |
| BOM | JSON/YAML/TS без BOM, `.ps1` с BOM | PASS |

## 2. Автотесты

```
Test Files  10 passed (10)
Tests       37 passed (37)
```

Покрыто:

- миграции v1→v2→v3, сохранение проектов;
- FTS5, память, версии, TTL, секреты;
- 7 профилей агентов, CRUD, лимиты;
- Task Engine: зависимости, lease, retry/backoff, recovery, события;
- Planner DAG;
- Dispatch fake `SubagentRuntime`: успех, ошибка, отсутствие сервиса;
- Dashboard: auth/401, cookie redirect, POST→405, stop;
- **Sync**: outbox trigger, push A → pull B между двумя SQLite, LWW update,
  offline/backoff, auth failure;
- 32 инструмента, включая `factory_sync`.

## 3. Живой DSH

- HMR загрузил AI Factory **v0.5.0**.
- `factory.started`: schema **3**, agents 7, tools **32**.
- SQLite v3: `sync_outbox`, `sync_state`, `sync_apply_guard`, triggers
  `memory_sync_insert/update`.
- 27 прежних плагинов сохранены.
- Схема `factory_sync` доставлена в Web GUI-сессию.
- `doctor.ps1` проходит.

## 4. Dashboard

Браузерная проверка выполнена на demo-runtime (v0.4.0); UI не менялся с
0.5.0. Проверены Обзор, Агенты, Задачи, Настройки; screenshot:
[docs/assets/dashboard-overview.png](docs/assets/dashboard-overview.png).
Read-only API, токен/cookie, 401/405 проверены автотестами.

## 5. Sync

Контракт описан в [docs/sync-protocol.md](docs/sync-protocol.md).

Проверено mock-сервером:

- A: remember → outbox row → push → accepted/sent;
- B (отдельная SQLite): pull → запись применена, обратного outbox нет;
- A update → push → B pull (LWW по updatedAt);
- сервер недоступен: операция остаётся, attempts/backoff, статус failed;
- неверный Bearer-токен: push отклонён, операция не потеряна.

**Не проверено:** production PostgreSQL/pgvector-сервер, второй физический ПК,
автоматический flush outbox, server-side conflict journal.

## 6. Release / portability

- `dist/dsh-ai-factory-0.5.0.tgz`: **121 920 байт**.
- SHA256: `27b8ede14fb51046c66c2c73de799e060929e56239bcd58a3a825c5e219eb7a7`.
- `verify-package.ps1`: обязательные файлы есть, `node_modules` нет.
- `portable-test` обновлён с 0.4.0 на 0.5.0 из tarball:
  - dependency `file:...0.5.0.tgz`;
  - schema 3, 7 агентов, 32 инструмента;
  - boot `factory.started` v0.5.0.
- Release workflow на тег `v*` готов; GitHub Release не создан (нет remote).

## 7. Ограничения / не проверено

- Production sync-сервер (PostgreSQL/pgvector) отсутствует.
- Live tool-calls (dispatch/dashboard/sync) из модели в Web GUI не выполнены:
  текущий клиент не инициирует tool-call; схемы доставлены.
- Scoped tool allowlist, Model Router, auto REVIEWER/Workflow не реализованы.
- Полный restart DSH после 0.5.0 не выполнен.
- Физически второй ПК не проверялся.

## 8. Повтор

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/doctor.ps1 -Profile desktop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1
```
