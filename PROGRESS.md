# Прогресс

## 2026-11-10

### Discovery

- Подтверждена версия DSH 0.2.2-rc.1, Electron 44.7.0, Node 24.21, pnpm 11.28.5.
- Извлечены официальные type-пакеты DSH; изучены `dsh-tools`, `dsh-agent`,
  Cordis, `dsh-package-manifest`.
- Подтверждён API `defineTool`, `ctx.tools.register`, `ctx.effect`,
  `ctx.logger`, `ctx.agents`.
- Создан [DISCOVERY.md](docs/DISCOVERY.md).

### Foundation

- Создан workspace и пакет `plugin/` с ESM + TypeScript strict.
- Реализованы:
  - SQLite-драйвер и миграции;
  - проектный реестр;
  - Memory Engine с FTS5, версиями, дедупликацией, TTL и soft delete;
  - фильтр секретов и prompt-injection маркеры;
  - аудит;
  - 8 инструментов DSH;
  - диагностика при ошибке старта.
- Сборка и 16 автотестов проходят.
- Плагин установлен в изолированный профиль `factory-test`; DSH загрузил его,
  создал `factory.db`, схему v1 и audit `factory.started` / `factory.stopped`.
- Драйвер `node:sqlite` подтверждён в реальном Electron-процессе DSH.

### Установка в основной профиль

- Сделан backup профиля и данных.
- Плагин установлен в `desktop` через официальный `dsh plugin add`.
- Работающий DSH горячо смонтировал плагин без перезапуска:
  audit `factory.started`, `factory.tools_registered` (8 инструментов).
- Схемы инструментов появились в текущей Web GUI-сессии.
- `scripts/doctor.ps1` проходит без проблем.
- Все 27 ранее установленных плагинов сохранены; версии не менялись.

### Открыто

- Вызвать memory-tool из модели в Web GUI (схемы уже доставлены).
- Task Engine и агентное ядро — следующие фазы.
- Скрипты эксплуатации проверены, кроме restore на живой БД.
