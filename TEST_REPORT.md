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
Test Files  9 passed (9)
Tests       34 passed (34)
```

Покрыто:

- миграции v1→v2, сохранение данных;
- FTS5, память, версии, TTL, секреты;
- 7 профилей агентов, CRUD, лимиты;
- Task Engine: зависимости, lease, retry/backoff, recovery, события;
- Planner DAG и продвижение шагов;
- Dispatch через fake `SubagentRuntime`: успех, ошибка, отсутствие сервиса;
- Dashboard:
  - 401 без токена;
  - Bearer-токен → 200 и реальный JSON;
  - токен в URL → 302 + HttpOnly-cookie → HTML;
  - POST → 405 (read-only);
  - остановка сервера освобождает порт;
- 31 инструмент, включая `factory_dashboard`.

## 3. Живой DSH

- HMR загрузил AI Factory **v0.4.0**.
- `factory.started`: schema 2, agents 7, tools 31;
- SQLite schema 2, 7 профилей;
- 27 прежних плагинов сохранены;
- схема `factory_dashboard` доставлена в Web GUI-сессию;
- `doctor.ps1` проходит.

## 4. Браузерная проверка dashboard

Запущен локальный demo-runtime (SQLite, 7 агентов, план из 3 задач, 2 записи
памяти) и `DashboardServer` на ephemeral-порту.

Проверено в браузере:

- токен в URL → редирект `/` + HttpOnly-cookie, токен исчезает из адресной
  строки;
- Обзор: 7 агентов, 4 активных задачи, 2 записи памяти, очередь по статусам,
  системные факты;
- Агенты: 7 карточек с ролями, доступом, лимитами, инструментами;
- Задачи: таблица с RUNNING/WAITING/PLANNING, приоритетом, попытками;
- Настройки: реальные config-поля и честные `plan`-пометки для
  Model Router, REVIEWER, Server sync, GitHub;
- адаптивная вёрстка, русский интерфейс, без внешних CDN.

Скриншот: [docs/assets/dashboard-overview.png](docs/assets/dashboard-overview.png).

## 5. Ограничения / не проверено

- Live-вызов `factory_dashboard` из модели в Web GUI ещё не сделан; сервер
  проверен напрямую в тестах и браузере.
- Live dispatch с реальной LLM не выполнен; fake-service контракт пройден.
- Tool allowlist ребёнка и Model Router не реализованы.
- Dashboard read-only; Workflows/KB/Models/Scheduler/Security/Server/GitHub
  разделов пока нет.
- Полный restart DSH после v0.4.0 не выполнен.

## 6. Повтор

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/doctor.ps1 -Profile desktop
```

Live smoke в чате:

> Вызови `factory_dashboard` с action=start и дай мне URL. Затем `factory_status`.
