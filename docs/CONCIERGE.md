# CONCIERGE v2 — Независимый Секретарь

Версия: **0.29.1**.

## Что это

CONCIERGE v2 — in-process router, который отвечает на статус/стоп, пока
DIRECTOR занят. Он **не создаёт фоновую LLM-сессию** и не вызывает модель:
ответы детерминированные.

## Точка перехвата

Раньше listener ждал `user/message`. Это событие появляется только после
`inbox.claim()` и уже во время turn DIRECTOR, поэтому перехватить сообщение
было нельзя.

Попытка удалить сообщение прямо из `session/event → agent/inbox/spliced`
приводит к DSH-ошибке:

```text
session append cannot reenter while another append is being published
```

Поэтому фактический обработчик подписан на agent-scoped событие:

```text
agent.ctx.on('agent/inbox/inserted', payload)
```

Оно публикуется после завершения исходного `session.append`. Глобальный
`session/event` используется только для обнаружения root-агента и
подписки на его контекст.

## Условия перехвата

1. root-only: `session.header.parentSession == null`;
2. `session.header.origin !== 'subagent'`;
3. `agent.status === 'running'`;
4. `agent.inbox.remove(message.id) === true`.

Если `remove()` вернул `false`, сообщение уже забрано. В этом случае:

- ответ не добавляется;
- пишется audit `concierge.race_lost`.

## Intent

| Intent | Условие | Действие |
|---|---|---|
| status | `как дела`, `как ты`, `что там`, `что происходит`, `статус`, `отчёт`, `how are you` | краткий отчёт по задачам |
| stop | `стоп`, `stop`, `останови`, `отмени`, `cancel` | followup/cancel RUNNING-задач |
| explicit | `/concierge ...` | всегда перехватывается |
| work | work-маркеры: `напиши`, `сделай`, `исправь`, `python`, `файл`, `создай`, … | не перехватывается |
| ambiguous | всё остальное | не перехватывается |

Рабочие задачи, вложения, длинные сообщения и неоднозначные формулировки
остаются DIRECTOR.

## Порядок ответа

```text
inbox.remove(id)
  → true
  → append assistant/message
  → audit intercepted/replied
```

Если append недоступен или бросил исключение:

- сообщение возвращается в inbox через `inbox.prepend('next-turn', message)`;
- audit `concierge.failed`.

## Audit

```text
concierge.intercepted
concierge.skipped
concierge.race_lost
concierge.replied
concierge.failed
```

Audit не хранит текст сообщения и секреты.

## Тесты

- busy DIRECTOR + «Как дела?» → remove + reply;
- idle DIRECTOR → сообщение остаётся;
- busy + «Напиши код» → сообщение остаётся;
- race `remove=false` → нет reply;
- child session → не перехватывается;
- `/concierge` → всегда перехватывается;
- stop → cancel/followup;
- append unavailable → сообщение возвращается.

## Ограничения

- Перехват происходит после вставки в inbox; официального pre-inbox hook нет.
- `agent/inbox/inserted` и wake могут конкурировать; защита — проверка
  результата `remove()`.
- Нельзя вызывать `inbox.remove()` из `session/event → agent/inbox/spliced`:
  DSH запрещает reentrant append.
- Пока нет диалоговой LLM-сессии CONCIERGE; это следующий этап при
  необходимости.
