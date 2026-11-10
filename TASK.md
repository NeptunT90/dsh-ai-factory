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

- Живой smoke: `factory_plan_create` → `factory_task_claim` →
  `factory_dispatch` с моделью.
- Проверить `factory_dashboard` в живом DSH и открыть URL.
- Настроить GitHub remote, tag `v0.4.0`, Release по workflow.
- Фактическая установка на второй ПК; upgrade-тест.
- Ограничение инструментов дочернего агента через scoped registration/restrict.
- Model Router: fallback, выбор по роли, стоимость/контекст.
- Автоматический DIRECTOR-цикл: claim → dispatch → REVIEWER → fix.
- Server sync (PostgreSQL/pgvector), остальные разделы dashboard.

## Запреты

- Не менять исходники DSH.
- Не публиковать секреты и содержимое пользовательской памяти.
- Не удалять данные без явного флага.
- Не выдавать профили агентов за запущенных LLM-агентов.
- Не выдавать план за реализацию.
