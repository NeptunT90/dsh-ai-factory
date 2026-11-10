# Sync protocol (v1)

Статус: **клиент и локальный outbox реализованы и протестированы; production
PostgreSQL-сервер ещё не развёрнут.** Тестовый mock-сервер реализует этот
контракт и подтверждает push/pull между двумя SQLite-runtime.

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

## Outbox

SQLite triggers создают `sync_outbox` на реальные изменения
`memory_entries` (insert/update по version). Поля: `op_id`, `entity_id`,
`operation`, `payload`, `base_version`, `attempts`, `next_attempt_at`,
`sent_at`, `last_error`. Сетевые ошибки оставляют операцию и включают
экспоненциальный backoff.

## Сервер (следующий шаг)

Планируемая реализация: Node REST API + PostgreSQL + pgvector, Docker Compose,
migrations, healthcheck, backup. До её появления `factory_sync` можно
проверять только с тестовым сервером, а локальный режим полностью работает без
синхронизации.
