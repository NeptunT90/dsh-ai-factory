# Текущий блок

**PHASE 1–5 + Autonomy + Self-Improvement (v0.30.1 Beta).**

1. Crash Recovery: REPAIRER, `scripts/watchdog.ps1`, startup recovery task, idempotency.
2. Human feedback: `factory_task_tell`, active child followup, metadata fallback.
3. Natural Language Routing: DIRECTOR interface prompt + few-shot.
4. Dashboard UX: `dashboardAutoStart`, startup link, clickable tool link, client API fallback.
5. 66 tools, 9 built-ins; health 63/71; 163 tests.
6. Async dispatch + completion notifications.
7. SafetyPolicy, egress, task_steps/factory_metrics, CURATOR/improvement, schema v9.

Дальше: финальный коммит и внешний Watchdog как отдельный production-блок.

## Предыдущий блок: browser/sync/live sync

Сделано:

1. Browser-* добавлены в host guard; NOFILE browser_open → unknown tool (не смонтирован).
2. SYNCONLY: factory_sync работает, read недоступен; произвольный путь не принимается.
3. Desktop live sync: push 2, pull remote 1, cursor 3; health 3/3; конфиг восстановлен.
4. 58 тестов, plugin 0.17.0.

## Предыдущий блок: четыре долга

Сделано:

1. Host-capability allowlist: read/write/pwsh/run_code/aliases; RESEARCHER без file-tools.
2. Live: read → unknown tool, write → TOOL_NOT_ALLOWED; bypass не воспроизведён.
3. stop() ждёт tick до 5 c, abort, затем dispose.
4. Fallback подавляется после successfulTools>0.
5. FAIL → fix PASS → исходная COMPLETED (completed_after_fix).
6. 58 тестов, plugin 0.17.0, server 0.17.0.

## Предыдущий блок: release artifact

Сделано:

1. `scripts/package-server.ps1`: server tarball + SHA256.
2. `dist/dsh-ai-factory-sync-server-0.17.0.tgz` (17 189 байт).
3. Plugin tarball 0.16.0 и server tarball в общем SHA256SUMS.
4. Clean-room install: npm install, health, push/pull.
5. 56 plugin-тестов, 10 server-тестов.

Осталось: фактический Ubuntu/Docker deploy, GitHub Release, второй ПК.

## Предыдущий блок: multi-writer

Сделано:

1. PgStore резервирует `opId` через `ON CONFLICT` до применения payload.
2. Два writer-процесса принимают один `opId` ровно один раз.
3. 10 server-тестов; PGlite остаётся single-writer.
4. Plugin 0.16.0 (56 тестов, 36 инструментов); server 0.17.0.

Осталось: фактический Ubuntu/Docker deploy, GitHub Release, второй ПК.
