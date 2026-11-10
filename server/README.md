# AI Factory sync server

Необязательный сервер синхронизации durable-памяти. Использует **PGlite** —
настоящий PostgreSQL, скомпилированный в WASM, с расширением **pgvector**.
Данные лежат в локальном каталоге, сервер не требует установки PostgreSQL.

## Запуск без Docker

```powershell
pnpm install
pnpm server:build

$env:SYNC_TOKEN = "длинный-случайный-токен"
$env:SYNC_DB_DIR = "C:\dsh-ai-factory-server\data"
$env:SYNC_PORT = "8787"
$env:SYNC_HOST = "127.0.0.1"
node server/dist/index.js
```

Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
# { ok: true, vector: true, service: "dsh-ai-factory-sync", protocol: 1, ... }
```

## Docker Compose

```bash
cd server
echo "SYNC_TOKEN=длинный-случайный-токен" > .env
docker compose up -d --build
curl http://127.0.0.1:8787/health
```

Порт опубликован только на loopback. Для доступа с другого ПК поставьте
HTTPS reverse proxy (Caddy/Nginx) и не открывайте HTTP напрямую.

## Подключение DSH AI Factory

В профиле плагина:

```yaml
- id: ai-factory
  config:
    syncUrl: https://factory.example.com
    syncTokenEnv: DSH_AI_FACTORY_SYNC_TOKEN
```

В окружении DSH:

```powershell
$env:DSH_AI_FACTORY_SYNC_TOKEN = "тот-же-токен"
```

Затем в чате:

> Вызови `factory_sync` с action=sync.

## API

Контракт: [docs/sync-protocol.md](../docs/sync-protocol.md).

- `GET /health` — без токена, только факт работы/pgvector/счётчики.
- `POST /v1/sync/push` — Bearer, idempotent `opId`.
- `GET /v1/sync/pull?since=<cursor>` — Bearer, LWW/cursor.

## Backup

Сервер отдаёт consistent tar.gz через защищённый endpoint:

```powershell
$env:SYNC_TOKEN = "тот-же-токен"
powershell -NoProfile -ExecutionPolicy Bypass -File ..\scripts\server-backup.ps1 `
  -Url http://127.0.0.1:8787 -OutFile .\sync-backup.tar.gz
```

Restore (server остановлен, целевой каталог пуст):

```powershell
node server\scripts\restore.mjs .\sync-backup.tar.gz C:\sync-restore\data
```

Скрипт загружает dump через PGlite `loadDataDir`, проверяет pgvector/health и
отказывается писать в непустой каталог. Затем:

1. Сохранить/переименовать старый `SYNC_DB_DIR`.
2. Запустить сервер с восстановленным каталогом.
3. Проверить `/health` (`memories`/`operations`).

Архив содержит полноценный PGlite data-dir; не публикуйте его — там память
пользователя.

## Ограничения

- PGlite — embedded single-process PostgreSQL; для нескольких writer-хостов
  нужен standalone PostgreSQL + `pg` adapter (следующий шаг).
- Нет встроенного TLS: используйте reverse proxy с HTTPS.
- Нет автоматического backup-планировщика: endpoint/скрипт запускаются вручную.
- Сервер не логирует payload памяти.
- Конфликты push возвращаются клиенту; автоматического merge/CRDT нет.
