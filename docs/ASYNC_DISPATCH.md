# Async Dispatch, Notifications and factory_run

Версия: **0.30.2**.

## Что изменилось

`factory_dispatch` по умолчанию работает асинхронно:

```text
task READY
  → claim → RUNNING
  → child agent в фоне
  → tool сразу возвращает taskId
  → DIRECTOR свободен
```

`async: false` оставляет старый синхронный режим.

Фоновый child получает отдельный `AbortSignal`, не связанный с foreground
turn, поэтому завершение хода DIRECTOR не отменяет задачу.

## Уведомление о завершении

После перехода задачи в `COMPLETED`, `FAILED` или `REVIEW` в главную сессию
публикуется assistant-сообщение:

```text
✅ Фоновая задача «…» завершена. Результат: …
❌ Фоновая задача «…» упала. Ошибка: …
✅ Фоновая задача «…» завершена и ждёт ревью. Результат: …
```

Просто `session.append('assistant/message')` вне turn DSH Web не показывает.
Поэтому уведомление оборачивается в synthetic turn:

```text
turn/start
step/start
assistant/message   (surfaceOp: append)
step/end
turn/end
```

Это отображение, а не новый model turn; модель не вызывается.

## factory_run

Новый root-only R1-инструмент:

```text
factory_run(
  title: string,
  description?: string,
  role?: director|researcher|developer|sysadmin|analyst|executor|reviewer|custom,
  async?: boolean = true
)
```

Он:

1. находит включённый профиль роли;
2. создаёт задачу с `assignedAgentId`;
3. вызывает async dispatch;
4. возвращает `taskId`.

Больше не нужно вручную вызывать `factory_task_create` + `factory_dispatch`.

