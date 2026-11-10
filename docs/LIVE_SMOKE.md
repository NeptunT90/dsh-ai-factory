# Live smoke — v0.7.0

Дата: 2026-11-10  
DSH Desktop 0.2.2-rc.1, AI Factory 0.7–0.9, schema v4, 35 инструментов.

Все вызовы ниже сделаны **из Web GUI-сессии** через реальные tool-calls, не из
unit-тестов. Секреты и dashboard-токен не сохранены.

## 1. Статус

`factory_status`:

```
DSH AI Factory 0.7.0: работает
хранилище: node:sqlite
БД: C:\Users\drgnu\.dsh\ai-factory\factory.db
схема: v3
проектов: 0 · агентов: 7 · задач: 0
память: 0 активных
```

## 2. Память

`factory_memory_remember` (global, episodic, verified) создал
`mem_b0e45f25-b005-42b8-b45c-d430e3b2182d`.

`factory_memory_search` по «Live smoke» нашёл эту запись через реальный FTS5.

## 3. Реальный dispatch

Создана задача `tsk_a2e5f83e-8d81-4f9c-831f-8f4cea12b4b0` («Live smoke:
PONG»).

`factory_dispatch` с prompt «Не вызывай инструменты, не меняй файлы. Верни
ровно: PONG» запустил реального child-агента:

```
дочерний агент: 0adb4aa8-839e-4953-8c9d-98cd78492422 (agt_executor)
остановка: completed
PONG
статус задачи: COMPLETED
```

Это подтверждает полный путь `ctx.subagents` → child session → Task Engine,
а не fake-service.

## 4. Реальный REVIEWER

Создана задача `tsk_4336caca-7063-459f-b244-7476dbdf36b6`, переведена в
REVIEW с результатом `REVIEW_OK: ...`.

`factory_review` запустил отдельного child REVIEWER:

```
вердикт: PASS
статус задачи: COMPLETED
reviewer child: fa6e4cad-1163-40ee-85de-f3c819a941eb
```

REVIEWER independently проверил задачу, `git status --porcelain` и состояние
Task Engine; задача закрыта, fix-задача не создавалась.

## 5. Реальный workflow

Создана задача `tsk_28c73300-a2f3-46a8-bb76-114000416b23`, переведена в
REVIEW с результатом `WORKFLOW_OK: ...`.

`factory_workflow_run` с `maxCycles=2` и критерием «PASS, если result содержит
WORKFLOW_OK»:

```
workflow: PASSED
Ревью пройдено: PASS.
цикл 1: tsk_28c73300… → PASS (COMPLETED)
```

`factory_task_get` подтвердил COMPLETED и review-текст с фактической проверкой
Task Engine/БД. Это live-проверка workflow на REVIEW-задаче.

### Полная ветка FAIL → fix → PASS

Задача `tsk_6375418b-eaae-4302-9f0d-464f332c842c` создана READY с требованием
вернуть PONG. `factory_workflow_run(maxCycles=2)`:

```
workflow: PASSED
цикл 1: tsk_6375418b… → FAIL (FAILED), fix tsk_ecefb80a…
цикл 2: tsk_ecefb80a… → PASS (COMPLETED)
```

Проверено через `factory_task_get`:

- исходная задача — FAILED, result `PONG`, ошибка `VERDICT: FAIL`;
- REVIEWER создал fix-задачу `tsk_ecefb80a-2f6e-4872-b331-0a5b5b752ebf`;
- fix-исполнитель — реальный `agt_developer`, вернул ровно `WORKFLOW_FIXED`;
- повторный REVIEWER — PASS, fix-задача COMPLETED.

Это полный live-цикл, включая реальный FAIL и автоматический запуск
fix-задачи.

### Найденный и исправленный дефект

Live-проверка показала: при PASS `tasks.complete` перезаписывал result
исполнителя review-текстом. В 0.7.1 `ReviewerService` сохраняет исходный
result и добавляет review через разделитель `--- REVIEW ---`; тест проверяет
наличие обоих текстов.

## 6. Dashboard

`factory_dashboard start` поднял loopback read-only панель. Браузер открыл
`127.0.0.1` с токеном из URL; токен превратился в HttpOnly-cookie и исчез из
адресной строки. Панель показала 2 задачи, 1 память, audit `review.*`.

Скриншот: [assets/dashboard-live-v0.7.0.png](assets/dashboard-live-v0.7.0.png).

## 7. Scoped allowlist (v0.8.0)

RESEARCHER-задача `tsk_84b3e2c0…` запустила child `ses_a7143044…`; попытка
`factory_memory_forget` вернула:

```
TOOL_NOT_ALLOWED: factory_memory_forget не входит в allowlist профиля ребёнка
```

Запись `mem_b0e45f25…` осталась активной. Scoped REVIEWER
`tsk_7804a5a0…` завершился PASS.

DEVELOPER child `ses_ef302b7a…` попытался вызвать `factory_dispatch`:

```
Error: TOOL_NOT_ALLOWED: factory_dispatch не входит в allowlist профиля ребёнка
```

Внук не создан. Scoped workflow `tsk_fd7a9724…` завершился PASSED.
Полная модель — [SCOPED_TOOLS.md](SCOPED_TOOLS.md).

## 8. Ограничения smoke

- Live workflow полностью проверен: REVIEW→PASS и FAIL→fix→PASS.
- Сервер синхронизации в live-режиме не подключался; e2e PGlite проверен
  отдельно.
- Это smoke намеренно не менял файлы проекта.
