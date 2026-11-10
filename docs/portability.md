# Переносимость

## Что разделено

| Слой | Где | В git? |
|---|---|---|
| Исходники | `plugin/`, `scripts/`, `docs/` | да |
| Конфигурация профиля DSH | `%USERPROFILE%\.dsh\profiles\<profile>` | нет (backup отдельно) |
| Локальная память/задачи | `%USERPROFILE%\.dsh\ai-factory` | нет |
| Секреты DSH | credential service | нет |
| Серверная память | Phase 4, PostgreSQL/pgvector | нет |

Абсолютных путей разработчика в коде нет. Путь данных настраивается через
`dataDir`; `~`/`%ENV%` раскрываются. Project id по умолчанию зависит от
canonical path; для переносимого проекта задайте одинаковый
`projectIdOverride` на обеих машинах.

## Установка на второй ПК

Вариант A — из исходников:

```powershell
git clone <repo-url> dsh-ai-factory
cd dsh-ai-factory
pnpm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Profile desktop
```

Вариант B — из релизного tarball:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 `
  -Profile desktop -Tarball .\dsh-ai-factory-0.10.1.tgz
```

Оба варианта используют официальный `dsh plugin add` и добавляют bundle.
Проверка: `factory_status` → `schemaVersion: 4`, `agents: 7`.

## Проверка переносимости

- `plugin/package.json` не содержит абсолютных путей и машинных id.
- `scripts/package.ps1` собирает tarball без `node_modules`, с `lib/`,
  manifest и bundle patch.
- tarball установлен в отдельный профиль `portable-test` как обычная папка
  (не junction/link), DSH загрузил v0.9.0 и 35 инструментов.
- `scripts/install.ps1 -Tarball` не зависит от dev-сборки на машине установки.
- Секреты не входят в tarball и не пишутся в память.
- `scripts/backup.ps1` использует `VACUUM INTO` для консистентного SQLite-
  снимка; `restore.ps1` сохраняет текущую БД перед заменой.

## Ограничения

- Физически второй компьютер не проверялся; проверен отдельный профиль на том
  же DSH 0.2.2-rc.1.
- Перенос проектной памяти между разными путями требует
  `projectIdOverride` или будущей серверной синхронизации.
- После перезапуска DSH dashboard нужно запускать снова; фонового сервиса нет.
