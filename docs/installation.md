# Установка

## Требования

- DeepSeek Harness Desktop 0.2.2-rc.1.
- Профиль DSH (`desktop` по умолчанию).
- Node.js >= 22.19 и pnpm для сборки из исходников.

## Из исходников

```powershell
git clone <repo-url> dsh-ai-factory
cd dsh-ai-factory
pnpm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop
```

Скрипт собирает `plugin/`, делает backup конфигурации профиля и вызывает
официальный `dsh plugin --profile desktop add link:<repo>/plugin`.

## Проверка

В чате DSH:

> Вызови `factory_status` и покажи сырые поля.

Ожидаемо:

- `status: ready`
- `driver: node:sqlite`
- `schemaVersion: 2`
- `agents: 7`

Для `factory_dispatch` в профиле должны быть активны `dsh-subagent` и
`dsh-subagent-spawn-in-process`. Если сервиса нет, инструмент возвращает
понятную ошибку `UNAVAILABLE` и не захватывает задачу.
- `dbPath` указывает на `%USERPROFILE%\.dsh\ai-factory\factory.db`

Затем:

> Запомни через factory_memory_remember факт: «AI Factory Phase 1 использует
> SQLite». Затем найди его через factory_memory_search.

## Если плагин не появился

1. Проверьте `%USERPROFILE%\.dsh\profiles\desktop\package.json`:
   - `dependencies.dsh-ai-factory`;
   - `dsh.profile.bundles` содержит `dsh-ai-factory`.
2. Запустите `scripts/doctor.ps1`.
3. Перезапустите DSH Desktop.
4. Посмотрите `factory_status` — если `status: error`, текст ошибки будет в
   ответе инструмента.

## Удаление

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall.ps1 -Profile desktop
```

Память сохраняется. Для удаления данных:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall.ps1 -Profile desktop -PurgeData
```

## Резервное копирование

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup.ps1 -Profile desktop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore.ps1 -BackupDir <путь> -Force
```

`backup.ps1` делает консистентный SQLite-снимок через `VACUUM INTO` и копирует
конфигурацию профиля.
