# Changelog

## [0.1.0] — 2026-11-10

### Added

- Устанавливаемый DSH-плагин `dsh-ai-factory` для DeepSeek Harness Desktop
  0.2.2-rc.1.
- SQLite-хранилище на `node:sqlite` с WAL, миграциями и FTS5.
- Memory Engine v1: пять типов памяти, project/global scope, trust, confidence,
  TTL, дедупликация, версии и soft delete.
- Инструменты `factory_status` и семь `factory_memory_*`.
- Проектный реестр по canonical path с `projectIdOverride`.
- Фильтр секретов, маркеры prompt-injection, durable audit.
- Диагностика при ошибке старта: `factory_status` остаётся доступным.
- 16 автотестов Vitest; строгая TypeScript-сборка.
- Скрипты install/uninstall/backup/restore/doctor.
- Документация DISCOVERY, ARCHITECTURE, PLAN, установка и конфигурация.
- Проверка загрузки в изолированном профиле DSH с созданием схемы v1.

### Known limitations

- `node:sqlite` в Node 24 помечен experimental (в DSH 0.2.2-rc.1 проверен).
- Семантический поиск/embeddings ещё не реализованы.
- Нет Task Engine, агентов, dashboard, server sync — следующие фазы.
