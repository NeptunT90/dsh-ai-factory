# Текущий блок

**BLOCK 4 — Capability Discovery закрыт.**

Сделано:

1. Migration v7, 14 статических capabilities, filesystem detector, opt-in probes.
2. Cache TTL 6h; capabilityCheck только кэш; Docker presence-only; scan default off.
3. 5 root-only tools; Planner/task/dispatch requiresCapabilities preflight.
4. 51 tool, health 48 factory tools / 56 actions; 116 tests.
5. Plugin 0.21.0, root 0.22.0, server 0.17.0.

Дальше: BLOCK 5/6 по плану. После BLOCK 6 — Watchdog (scripts/watchdog.ps1).

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
