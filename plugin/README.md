# dsh-ai-factory

Устанавливаемый плагин **DSH AI Factory** для DeepSeek Harness Desktop
0.2.2-rc.1: durable-память, реестр профилей специалистов, Task Engine с
зависимостями/lease/recovery, Planner, реальный dispatch дочернего агента через
`ctx.subagents` и локальный read-only dashboard.

## Установка

Из корня репозитория:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop
```

Из релизного tarball:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop -Tarball .\dist\dsh-ai-factory-0.5.0.tgz
```

## Проверка

В чате DSH:

> Вызови `factory_status` и покажи сырые поля.

Ожидаемо: `status: ready`, `driver: node:sqlite`, `schemaVersion: 3`,
`agents: 7`.

## Данные

`%USERPROFILE%\.dsh\ai-factory` — SQLite + WAL. Плагин не хранит секреты.
Dashboard запускается только по явному вызову `factory_dashboard` и слушает
`127.0.0.1`.

## Документация

Полная документация — в корне репозитория: `README.md`, `docs/ARCHITECTURE.md`,
`docs/DISCOVERY.md`, `docs/installation.md`, `TEST_REPORT.md`.

## Лицензия

MIT. См. `LICENSE`.
