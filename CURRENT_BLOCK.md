# Текущий блок

**Phase 4b — scheduled backups сервера.**

Сделано:

1. `BackupScheduler`: dump + SHA256, rotation, env-конфиг.
2. Docker Compose volume `/backups`.
3. 7 server-тестов; scheduler rotation PASS.
4. Plugin 0.10.1 без изменений; server 0.12.0.

Осталось: standalone PostgreSQL/TLS, GitHub Release, второй ПК.

## Предыдущий блок: restore CLI

Сделано:

1. `PGliteStore.restore(loadDataDir)` + guard непустого каталога.
2. `server/scripts/restore.mjs`; восстановление реального backup.
3. 6 server-тестов; CLI: memories=1, operations=2, vector=true.
4. Plugin 0.10.1 без изменений; server 0.11.0.

Осталось: standalone PostgreSQL/TLS, GitHub Release, второй ПК.

## Предыдущий блок: live Model fallback


Сделано:

1. BADROUTE invalid model → fallback deepseek-flash, COMPLETED.
2. Audit model.route/fallback; diagnostics sanitized in 0.10.1.
3. Dashboard Models/Sync live (0.10.0).
4. 54 теста, 35 инструментов, версия 0.10.1.

Осталось: standalone PostgreSQL/TLS, GitHub Release, второй ПК.

## Предыдущий блок: Dashboard Models/Sync


Сделано:

1. Вкладки «Модели» и «Синхронизация» (read-only).
2. Capabilities: Model Router, REVIEWER, Server sync — ready.
3. Live: router ON/2 attempts; sync configured=false, pending=1, auto=OFF.
4. 54 plugin-теста, 35 инструментов, версия 0.10.0.

Осталось: standalone PostgreSQL/TLS, GitHub Release, второй ПК.

## Предыдущий блок: Phase 3c — Model Router


Сделано:

1. `modelRouterEnabled`, `modelFallbacks`, `modelMaxAttempts`.
2. Route: профиль → родитель → fallbacks; retry после ошибки child.
3. `factory_model_route`; audit `model.route`/`model.fallback`.
4. Live: DEVELOPER/REVIEWER → `deepseek-official/deepseek-flash`.
5. 54 plugin-теста, 35 инструментов, версия 0.9.0.

Осталось: standalone PostgreSQL/TLS, GitHub Release, второй ПК.
