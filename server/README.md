# AI Factory sync server

Необязательный сервер синхронизации durable-памяти. Два режима:

- **standalone PostgreSQL** через `DATABASE_URL` (pgvector обязателен) —
  production/Docker Compose;
- **embedded PGlite** PostgreSQL/WASM без установки PostgreSQL — локальный
  режим и тесты.

Оба режима используют один `SyncStore`-контракт и один HTTP API.

## Запуск без Docker

Embedded PGlite:

```powershell
pnpm install
pnpm server:build

$env:SYNC_TOKEN = "длинный-случайный-токен"
$env:SYNC_DB_DIR = "C:\dsh-ai-factory-server\data"
$env:SYNC_PORT = "8787"
$env:SYNC_HOST = "127.0.0.1"
node server/dist/index.js
```

Standalone PostgreSQL (pgvector):

```powershell
$env:DATABASE_URL = "postgres://factory:password@127.0.0.1:5432/factory"
$env:SYNC_TOKEN = "длинный-случайный-токен"
node server/dist/index.js
```

Сервер сам создаёт `vector`, таблицы и sequence. `DATABASE_URL` имеет приоритет
над `SYNC_DB_DIR`.

### Direct TLS

```powershell
$env:SYNC_TLS_CERT_FILE = "C:\certs\cert.pem"
$env:SYNC_TLS_KEY_FILE  = "C:\certs\key.pem"
node server/dist/index.js
```

Оба файла обязательны вместе; сервер стартует как HTTPS и `/health` доступен
по HTTPS. Для внешнего production по-прежнему рекомендуется reverse proxy
(Caddy/Nginx) с автоматическим TLS; direct TLS — альтернатива.

Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
# { ok: true, vector: true, service: "dsh-ai-factory-sync", protocol: 1, ... }
```

## Docker Compose

```bash
cd server
cp .env.example .env
# измените SYNC_TOKEN и POSTGRES_PASSWORD
docker compose up -d --build
curl http://127.0.0.1:8787/health
```

Compose поднимает `pgvector/pgvector:pg16` + sync-сервер с `DATABASE_URL`,
healthcheck и volume `pgdata`. Порт sync опубликован только на loopback. Для
доступа с другого ПК поставьте HTTPS reverse proxy (Caddy/Nginx) и не
открывайте HTTP напрямую.

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

## Scheduled backups

Планировщик доступен только для embedded PGlite (`dump`); при standalone
PostgreSQL endpoint backup возвращает `501` — используйте `pg_dump`/infra
backup. Для PGlite задайте каталог и интервал:

```powershell
$env:SYNC_BACKUP_DIR = "C:\dsh-ai-factory-server\backups"
$env:SYNC_BACKUP_INTERVAL_HOURS = "24"
$env:SYNC_BACKUP_KEEP = "7"
```

Сервер пишет `dsh-ai-factory-sync-*.tar.gz` + `.sha256`, удаляет старые архивы
сверх `SYNC_BACKUP_KEEP`. Docker Compose уже монтирует `/backups` и задаёт эти
env. Планировщик стартует только при непустом `SYNC_BACKUP_DIR`.

## Ограничения

- Standalone PostgreSQL adapter (`pg`) проверен через PostgreSQL wire protocol
  (PGlite socket); реальный Docker/Ubuntu Compose в этом окружении не запускался.
- PGlite — embedded single-process; multi-writer требует внешнего PostgreSQL.
- Direct TLS реализован (cert/key env), но требует управления сертификатами;
  для production можно использовать reverse proxy.
- Backup-планировщик только для PGlite; PostgreSQL backup — через `pg_dump`.
- Restore PGlite не запускается автоматически после backup.
- Сервер не логирует payload памяти.
- Конфликты push возвращаются клиенту; автоматического merge/CRDT нет.
