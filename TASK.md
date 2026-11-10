# Текущие задачи

Обновлено: 2026-11-10.

## Сейчас

1. Финальный smoke в Web GUI:
   - `factory_status`;
   - `factory_plan_create` с 2–3 шагами;
   - `factory_task_claim` / `complete` для первого шага;
   - проверить, что зависимый шаг стал READY.
2. Полный перезапуск DSH и проверка сохранности схемы/задач.
3. Закоммитить Phase 2/3 core.

## Следующая очередь

- Standalone PostgreSQL/Ubuntu + TLS reverse proxy (нужен сервер/доступ;
  локально нет psql/Docker).
- Backup/restore планировщик сервера, multi-writer.
- CRDT/merge и server-side conflict journal.
- Автоматический flush outbox по таймеру.
- Живой smoke: `factory_plan_create` → `factory_task_claim` →
  `factory_dispatch`; `factory_dashboard`; `factory_sync`.
- Настроить GitHub remote/tag/Release.
- Установка на второй физический ПК; upgrade.
- Scoped-ограничение host-tools; Model Router; REVIEWER/Workflow.

## Запреты

- Не менять исходники DSH.
- Не публиковать секреты и содержимое пользовательской памяти.
- Не удалять данные без явного флага.
- Не выдавать профили агентов за запущенных LLM-агентов.
- Не выдавать план за реализацию.
