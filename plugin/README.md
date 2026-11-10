# dsh-ai-factory

Устанавливаемый плагин **DSH AI Factory** для DeepSeek Harness Desktop
0.2.2-rc.1: durable-память, реестр профилей специалистов, Task Engine с
зависимостями/lease/recovery, Planner, реальный dispatch дочернего агента через
`ctx.agents` с enforced allowlist, Model Router/fallback, независимый REVIEWER,
bounded и on-demand workflow, локальный read-only dashboard и синхронизация
памяти с PGlite/PostgreSQL-сервером.

## Установка

Из корня репозитория:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop
```

Из релизного tarball:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop -Tarball .\dist\dsh-ai-factory-0.22.0.tgz
```

## Проверка

В чате DSH:

> Вызови `factory_status` и покажи сырые поля.

Ожидаемо: `status: ready`, `driver: node:sqlite`, `schemaVersion: 4`,
`agents: 7`, 54 инструмента.

## Возможности

- `factory_dispatch` / `factory_review` — scoped child через `ctx.agents`.
- `factory_workflow_run` — bounded dispatch → review → fix.
- `factory_auto_workflow` — status/run/start/stop фонового цикла.
- `factory_model_route` — read-only Model Router.
- `factory_sync` — outbox/push/pull, auto-sync.
- `factory_dashboard` — loopback read-only панель (Models/Sync).
- Память, задачи, агенты, planner, аудит, recovery, backup/restore сервера.

## Данные

`%USERPROFILE%\.dsh\ai-factory` — SQLite + WAL. Плагин не хранит секреты.
Dashboard запускается только по явному вызову `factory_dashboard` и слушает
`127.0.0.1`.

## Документация

Полная документация — в корне репозитория: `README.md`, `docs/ARCHITECTURE.md`,
`docs/DISCOVERY.md`, `docs/installation.md`, `docs/sync-protocol.md`,
`TEST_REPORT.md`.

## Лицензия

MIT. См. `LICENSE`.
