# Текущий блок

**Phase 2b — реальный запуск дочернего агента через `ctx.subagents`.**

Сделано:

1. `factory_dispatch`: старт дочернего агента через официальный
   `ctx.subagents.startActivation` (провайдер `spawn`), ожидание результата.
2. Ребёнок получает отдельную сессию, проектный cwd, инструкцию/модель профиля
   и справочный контекст памяти.
3. Связка с Task Engine: READY → RUNNING → COMPLETED или retry/FAILED;
   heartbeat lease во время работы; запись результата в задачу.
4. 32 автотеста; dispatch-сценарии проверены с fake SubagentRuntime.
5. Плагин v0.3.0 загружен в живой DSH: schema 2, 7 агентов, 30 инструментов;
   схема `factory_dispatch` доставлена в Web GUI.

Осталось:

1. Проверить реальный dispatch с моделью в Web GUI (нужен чат-запрос).
2. Принудительно ограничить host-tools ребёнка по allowlist профиля.
3. Model Router: fallback, стоимость, ограничения контекста.
4. Автоматический DIRECTOR-цикл: claim → dispatch → review → fix.
5. Phase 3b: workflow-ветвления и автоматический execution loop.
6. Dashboard, server sync, GitHub — следующие фазы.

Критерий выхода Phase 2b: реальный ребёнок запускается и его результат
попадает в Task Engine — достигнут на уровне кода и fake-service теста; живой
вызов с моделью ещё нужно подтвердить.
