# Участие в разработке

## Правила

1. Не менять исходники DSH. Работать только через официальный plugin API.
2. Не добавлять фиктивные функции и «заглушки», которые выглядят как
   реализация.
3. Каждый модуль — с тестами и записью в `PROGRESS.md`.
4. Не коммитить секреты, БД и `node_modules`.
5. Новые миграции — только добавлением; существующие не редактировать.
6. Опасные действия (shell, SSH, удаление данных) — только с политикой
   approvals и отдельным тестом.

## Локальный цикл

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
pwsh -NoProfile -File scripts/doctor.ps1
```

## Стиль

- ESM, TypeScript strict, NodeNext.
- Импорты с `.js` в исходниках.
- Публичные функции и интерфейсы — с JSDoc на английском; пользовательские
  сообщения инструментов — на русском.
- Время — epoch milliseconds; id — с префиксом (`mem_`, `prj_`, `tsk_`).
- SQL — только параметризованный.
- Кодировка: JSON/YAML/TS — UTF-8 **без BOM**; PowerShell-скрипты для
  Windows PowerShell 5.1 — UTF-8 **с BOM**. `Set-Content -Encoding UTF8` в
  PowerShell 5.1 добавляет BOM и уже один раз ломал `package.json`.

## Коммиты

Короткие сообщения в императиве, например:

```
feat(memory): add FTS5 search with project filter
fix(plugin): keep factory_status available after storage failure
test(memory): cover version history and soft delete
```

Перед коммитом: `pnpm verify` и обновить `TEST_REPORT.md`, если менялись
критические проверки.
