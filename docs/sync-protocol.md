# Sync protocol (v1)

Статус: **клиент, outbox и сервер реализованы и проверены end-to-end.**
Сервер использует PGlite — настоящий PostgreSQL в WASM — с расширением
pgvector. Standalone PostgreSQL/Ubuntu-развёртывание пока не выполнено;
PGlite подходит для одного writer-процесса.

## Транспорт и авторизация

- HTTPS; HTTP разрешён только для `127.0.0.1`/`localhost`.
- `Authorization: Bearer <token>`.
- Токен берётся только из env-переменной, имя задаётся `syncTokenEnv`
  (default `DSH_AI_FACTORY_SYNC_TOKEN`); в конфиг и SQLite не пишется.
- `protocol: 1`.

## POST `/v1/sync/push`

```json
{
  "protocol": 1,
  "deviceId": "dev_...",
  "operations": [
    {
      "opId": "op_...",
      "entityId": "mem_...",
      "operation": "upsert",
      "baseVersion": 2,
      "payload": { "...": "RemoteMemoryPayload" }
    }
  ]
}
```

Ответ:

```json
{
  "accepted": ["op_..."],
  "conflicts": [{ "opId": "op_...", "entityId": "mem_...", "reason": "version conflict" }],
  "rejected": [{ "opId": "op_...", "reason": "invalid" }]
}
```

Сервер обязан:

- дедуплицировать по `opId` (идемпотентность);
- хранить `deviceId`, `opId`, `entityId`, `version`, `updatedAt`;
- атомарно применять операцию и записывать её в журнал;
- возвращать `accepted` только для реально сохранённых операций;
- при конфликте не терять серверную запись.

## GET `/v1/sync/pull?since=<cursor>&deviceId=<id>`

Ответ:

```json
{
  "changes": [{ "opId": "op_...", "payload": { "...": "RemoteMemoryPayload" } }],
  "cursor": "42"
}
```

- `cursor` — монотонный серверный sequence.
- Клиент применяет изменения по LWW `updatedAt` и сохраняет cursor только
  после успешного применения всей пачки.
- Pull не создаёт обратный outbox (SQLite guard).

## RemoteMemoryPayload

Содержит: `id`, `projectId/projectName/projectRoot`, `scope`, `kind`, `title`,
`content`, `tags`, `trust`, `confidence`, `sourceType`, `sourceRef`,
`agentId`, `sessionId`, `status`, `version`, `supersedesId`, `metadata`,
`createdAt`, `updatedAt`, `accessedAt`, `expiresAt`, `deletedAt`.

Секреты не должны попадать в payload: локальный Memory Engine отклоняет их до
записи. Сервер обязан не логировать содержимое.

## Конфликты

Текущая клиентская политика — LWW по `updatedAt` при pull; push-конфликты
помечаются в outbox и требуют ручного разрешения/повторной отправки. Это
сознательно простое поведение; CRDT/merge — следующий шаг.

## Auto-sync и backup

- `syncAuto: true` запускает push+pull каждые `syncIntervalSeconds` (мин. 15)
  при загруженном плагине; таймер `unref`-нут, снимается при unload.
- `status` показывает `auto`, `running`, `lastSyncAt`, `lastSyncError`.
- `GET /v1/admin/backup` (Bearer) отдаёт consistent `.tar.gz` PGlite data-dir;
  `scripts/server-backup.ps1` сохраняет файл и SHA256.
- Restore: `node server/scripts/restore.mjs <backup.tar.gz> <empty-dir>`.
  Скрипт использует PGlite `loadDataDir`, проверяет `vector`/`memories` и
  отказывается писать в непустой каталог. Затем сервер запускается на этом
  каталоге.
- Backup содержит память пользователя; не публиковать.

## Outbox

SQLite triggers создают `sync_outbox` на реальные изменения
`memory_entries` (insert/update по version). Поля: `op_id`, `entity_id`,
`operation`, `payload`, `base_version`, `attempts`, `next_attempt_at`,
`sent_at`, `last_error`. Сетевые ошибки оставляют операцию и включают
экспоненциальный backoff.

## Сервер

Реализован в `server/`:

- Node HTTP API, Bearer auth, `POST /v1/sync/push`, `GET /v1/sync/pull`,
  `GET /health`;
- PGlite (PostgreSQL/WASM) + pgvector `vector(1536)`; idempotency table
  `sync_operations`; monotonic `sync_change_seq`;
- LWW upsert + явный `409`-подобный conflict в ответе push;
- Dockerfile + Compose; данные в volume;
- `node --test` тесты store/HTTP.

Standalone PostgreSQL + `pg` adapter, TLS/reverse proxy, multi-writer,
backup-планировщик — следующие шаги. Локальный режим плагина работает без
сервера.
