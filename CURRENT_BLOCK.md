# Текущий блок

**Phase 9 (v1) — релизный tarball и установка на второй профиль.**

Сделано:

1. `scripts/package.ps1`: build → `pnpm pack` → verify → SHA256SUMS.
2. `scripts/verify-package.ps1`: manifest, lib, bundle patch, README/LICENSE,
   отсутствие `node_modules`, версия.
3. `scripts/install.ps1 -Tarball` и `scripts/update.ps1` (backup перед update).
4. `dist/dsh-ai-factory-0.4.0.tgz` собран (110432 байта) и проверен.
5. Tarball установлен в профиль `portable-test` как обычная папка (не link);
   DSH загрузил v0.4.0, schema 2, 7 агентов, 31 инструмент.
6. Release workflow на тег `v*`, документация release/portability.

Осталось:

1. Настроить GitHub remote, создать тег и Release (нужны credentials).
2. Проверить физически второй ПК.
3. Upgrade-тест с предыдущей версии с реальными данными.
4. Server sync (Phase 4), scoped-tools/Model Router (Phase 2c).
5. Dashboard: остальные разделы и live tool-call.

Критерий блока: артефакт собирается, проверяется и устанавливается без
`link:` — достигнут; публикация Release и второй ПК — нет.
