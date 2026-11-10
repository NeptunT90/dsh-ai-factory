# Текущий блок

**Phase 7 — Dashboard Models/Sync.**

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
