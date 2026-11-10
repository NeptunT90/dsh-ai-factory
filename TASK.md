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

- Production sync-сервер: PostgreSQL + pgvector, REST API, Docker Compose,
  токен, migrations, backup/restore.
- Автоматический flush outbox по таймеру + server-side conflict log.
- Живой smoke: `factory_plan_create` → `factory_task_claim` →
  `factory_dispatch` с моделью; `factory_dashboard`/`factory_sync`.
- Настроить GitHub remote, tag `v0.5.0`, Release по workflow.
- Установка на второй физический ПК; upgrade 0.4→0.5.
- Scoped-ограничение host-tools ребёнка; Model Router.
- Автономный DIRECTOR/REVIEWER-цикл, Workflow.

## Запреты

- Не менять исходники DSH.
- Не публиковать секреты и содержимое пользовательской памяти.
- Не удалять данные без явного флага.
- Не выдавать профили агентов за запущенных LLM-агентов.
- Не выдавать план за реализацию.
