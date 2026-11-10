# Текущий блок

**Phase 6b — bounded workflow dispatch → review → fix.**

Сделано:

1. `factory_dispatch review=true` оставляет задачу в REVIEW.
2. `factory_workflow_run` автоматически диспатчит executor, запускает
   REVIEWER, при FAIL берёт созданную fix-задачу и повторяет.
3. `maxCycles` 1–5; статусы PASSED/FAILED/EXHAUSTED/ERROR + история циклов.
4. Live smoke: реальный dispatch child (PONG), REVIEWER (PASS),
   workflow REVIEW→PASS и dashboard.
5. 45 plugin-тестов, 34 инструмента, версия 0.7.0.

Осталось: неограниченный автономный цикл/таймер, scoped tools/Model Router,
standalone PostgreSQL/TLS, GitHub Release, второй ПК.

---

## Предыдущий блок: Phase 4b — sync-сервер

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
6. Plugin 0.6.0: schema 3, 33 инструмента; 41 plugin-тест, 5 server-тестов.

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
