# Текущий блок

**Phase 4b — sync-сервер на PostgreSQL/PGlite + pgvector.**

Сделано:

1. Outbox, `factory_sync`, HTTPS/loopback, Bearer env-token, backoff.
2. `server/`:
   - PGlite (настоящий PostgreSQL/WASM) + pgvector `vector(1536)`;
   - `POST /v1/sync/push`, `GET /v1/sync/pull`, `/health`;
   - idempotency `sync_operations`, monotonic cursor, LWW и conflict;
   - Bearer auth, body limit, security headers;
   - Dockerfile, Docker Compose (loopback publish), README.
3. Store/HTTP тесты сервера — 5 passed.
4. End-to-end: A SQLite → HTTP → PGlite → B SQLite; update дошёл;
   health `vector: true`.
5. Auto-sync по таймеру и backup endpoint/скрипт.
6. Plugin 0.5.0: schema 3, 32 инструмента; 38 plugin-тестов, 5 server-тестов.

Осталось:

1. Развернуть standalone PostgreSQL/Ubuntu + TLS reverse proxy (нет psql/
   Docker в текущем окружении).
2. Backup/restore планировщик сервера, multi-writer.
3. CRDT/merge и server-side conflict journal.
4. Автоматический flush outbox по таймеру.
5. Второй физический ПК; GitHub Release.
6. Phase 2c scoped tools/Model Router, автономный REVIEWER/Workflow.

Критерий блока: реальный HTTP sync-сервер с PostgreSQL-семантикой и pgvector
обменивается памятью между двумя SQLite — достигнут локально; production
Ubuntu deployment — нет.
