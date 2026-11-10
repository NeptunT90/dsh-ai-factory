# Текущий блок

**Phase 4a — sync client и локальный outbox.**

Сделано:

1. Миграция v3: `sync_outbox`, `sync_state`, `sync_apply_guard`, triggers
   `memory_sync_insert/update`.
2. `factory_sync` (status/push/pull/sync).
3. Bearer-токен только из env (`syncTokenEnv`), HTTPS или loopback HTTP,
   cursor, идемпотентные `opId`, retry/backoff.
4. `MemoryEngine.applyRemote`: LWW по `updatedAt`, remap проекта, подавление
   обратного outbox, FTS.
5. 37 тестов; два независимых SQLite-runtime обмениваются памятью через
   mock-сервер. Offline и auth-failure сценарии проверены.
6. Live DSH v0.5.0: schema 3, 32 инструмента, triggers установлены.

Осталось:

1. Production sync-сервер: PostgreSQL + pgvector, REST API, Docker Compose,
   auth, migrations, backup/restore.
2. Автоматический flush outbox и server-side conflict log.
3. Второй физический ПК/сервер.
4. Scoped-tools/Model Router (Phase 2c), REVIEWER/Workflow.
5. Live tool-calls из модели в Web GUI.

Критерий блока: локальный outbox и push/pull проверены между двумя SQLite —
достигнут; полноценная серверная синхронизация — нет (нужен PostgreSQL).
