# Live smoke — v0.7.0

Дата: 2026-11-10  
DSH Desktop 0.2.2-rc.1, AI Factory 0.7.0, schema v3, 34 инструмента.

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

## 5. Dashboard

`factory_dashboard start` поднял loopback read-only панель. Браузер открыл
`127.0.0.1` с токеном из URL; токен превратился в HttpOnly-cookie и исчез из
адресной строки. Панель показала 2 задачи, 1 память, audit `review.*`.

Скриншот: [assets/dashboard-live-v0.7.0.png](assets/dashboard-live-v0.7.0.png).

## 6. Ограничения smoke

- Workflow `factory_workflow_run` в live-режиме не запускался (unit-тесты
  покрывают цикл); dispatch и REVIEWER проверены отдельно.
- Сервер синхронизации в live-режиме не подключался; e2e PGlite проверен
  отдельно.
- Это smoke намеренно не менял файлы проекта.
