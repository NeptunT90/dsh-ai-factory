# Релиз и установка на второй компьютер

## 1. Проверка перед релизом

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/doctor.ps1 -Profile desktop
```

Критические тесты должны пройти до упаковки. Версия берётся из
`plugin/package.json`; тег релиза — `v<version>`.

## 2. Сборка артефакта

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1
```

Скрипт:

1. собирает `plugin/lib`;
2. делает `pnpm pack` в `dist/`;
3. проверяет наличие `package.json`, `lib/index.js`, `cordis.patch.yml`,
   `README.md`, `LICENSE` и отсутствие `node_modules`;
4. пишет `dist/SHA256SUMS`.

Артефакт: `dist/dsh-ai-factory-0.5.0.tgz` — 121 920 байт,
SHA256 `27b8ede14fb51046c66c2c73de799e060929e56239bcd58a3a825c5e219eb7a7`.

## 3. Установка из tarball

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 `
  -Profile desktop `
  -Tarball .\dist\dsh-ai-factory-0.5.0.tgz
```

Скрипт делает backup конфигурации профиля, вызывает официальный
`dsh plugin --profile desktop add <tarball>` и проверяет dependency + bundle.
Данные в `%USERPROFILE%\.dsh\ai-factory` не удаляются.

## 4. Второй компьютер

1. Установить DSH Desktop **той же версии** 0.2.2-rc.1.
2. Склонировать репозиторий или скачать релизный `.tgz`.
3. Для установки из исходников:
   ```powershell
   pnpm install
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop
   ```
4. Для установки из tarball:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop -Tarball .\dsh-ai-factory-0.5.0.tgz
   ```
5. Проверить `factory_status`: `schemaVersion: 3`, `agents: 7`.
6. Перенести память только через `scripts/backup.ps1` / `restore.ps1` или
   серверную синхронизацию; не копировать `node_modules`.

Проверено: установка tarball в отдельный профиль `portable-test` (не `link:`)
создала обычную папку `node_modules/dsh-ai-factory`, добавила bundle и
загрузила v0.5.0 с 32 инструментами.

## 5. Обновление и откат

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/update.ps1 `
  -Profile desktop -Tarball .\dist\dsh-ai-factory-0.5.0.tgz
```

`update.ps1` сначала делает backup данных и профиля, затем устанавливает новую
версию. При проблеме:

1. остановить DSH;
2. восстановить данные `scripts/restore.ps1 -BackupDir <...> -Force`;
3. установить предыдущий tarball или `link:`-версию;
4. запустить `doctor.ps1`.

## 6. GitHub Actions

`.github/workflows/release.yml` запускается на тег `v*`:

- typecheck, tests, build;
- проверка соответствия тега версии пакета;
- `scripts/package.ps1` + `verify-package.ps1`;
- upload artifact и GitHub Release с `.tgz` и `SHA256SUMS`.

Workflow не публикует секреты и не требует npm-токена. Публикация в npm не
настроена намеренно: основной канал — GitHub Release/tarball.

## 7. Ограничения

- GitHub Release не создан, пока не настроен remote и нет тега.
- Установка проверена на этом же ПК в отдельном профиле, не на физически
  втором компьютере.
- Серверная синхронизация памяти — Phase 4, не входит в этот релиз.
