# Текущий блок

**Phase 2/3 core — Agent Registry, Task Engine, Planner, DIRECTOR brief.**

Сделано:

1. Миграция v2 применена на живой БД без потери данных.
2. 7 встроенных профилей специалистов и CRUD-реестр.
3. Task Engine с зависимостями, lease, heartbeat, retry/backoff, recovery,
   историей событий и продвижением зависимых задач.
4. Planner DAG и `factory_plan_create`.
5. `factory_director_brief` и `factory_tools_list`.
6. 29 инструментов зарегистрированы; 29 тестов проходят.
7. HMR перезагрузил плагин в `desktop`: v0.2.0, schema 2, 7 агентов,
   29 инструментов; схемы доставлены в Web GUI-сессию.

Осталось:

1. Финальный smoke: вызвать `factory_status`/`factory_plan_create` из модели.
2. Проверить сохранение задач после перезапуска DSH.
3. Phase 2b: фактический запуск дочерних агентов через `ctx.agents`,
   ограничение инструментов, Model Router.
4. Phase 3b: workflow-ветвления и автоматический execution loop.

Критерий выхода Phase 2/3 core: схема v2, реестр и очередь работают в DSH —
достигнут; критерий полной Phase 2/3 (автозапуск агентов и workflow) — нет.
