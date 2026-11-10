# Текущий блок

**BLOCK 1 — Tool Health Check.**

Сделано:

1. Migration v5: tool_health + tool_health_history.
2. Risk registry 44 action-записей / 36 factory-tools; R1=REGISTERED, R2=NOT_TESTABLE.
3. R0 probes через ctx.tools.execute; first live factory_status → HEALTHY 1ms.
4. 3 root-only health tools; effectiveAllowedTools только factory_*.
5. Dashboard health; docs/TOOL_HEALTH.md; 67 тестов.
6. Plugin 0.18.0, root 0.19.0, server 0.17.0.

Осталось: BLOCK 2 — factory_agent_save security; live full health sweep.

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
