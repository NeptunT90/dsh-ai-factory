# Scoped tool allowlist (Phase 2c)

Реализовано в **0.8.0**. Каждый профиль агента имеет явный `allowedTools`;
дочерние агенты создаются через `ctx.agents.create()` с `setup()`, а каждый
tool call проходит runtime guard.

## Модель

1. **SQLite schema v4**: `agent_profiles.allowed_tools` (JSON array).
2. **Создание ребёнка**:
   `ctx.agents.create({ setup(agentCtx) { agentCtx.tools.restrict(...) } })`.
   Setup выполняется до публикации агента.
3. **Deny-by-default**: пустой `allowedTools` у custom-профиля запрещает запуск
   ребёнка; built-in профили имеют явные списки.
4. **Runtime guard**: `ctx.tools.guard` проверяет
   `runtime.toolDenial(childId, toolName)` до тела инструмента. Вызов вне
   allowlist возвращает:
   `TOOL_NOT_ALLOWED: <tool> не входит в allowlist профиля ребёнка`.
5. **Host capabilities** (v0.17.0): отдельный список
   `HOST_TOOL_NAMES` + aliases (`read`, `write`, `edit`, `apply_patch`,
   `grep`, `glob`, `working_directory`, `bash`, `pwsh`, `terminal`,
   `run_code`, `read_file`, `write_file`, `fs_read`, `fs_write`, `shell`).
   Для host-имени отказ имеет вид
   `TOOL_NOT_ALLOWED: host capability <name> ...`; `run_code` не выдаётся
   ребёнку никогда.
6. Allowlist привязан к child session id до первого хода и удаляется в
   `finally`.

## Ключевые ограничения профилей

| Профиль | Запрещено (примеры) |
|---|---|
| DEVELOPER | `factory_dispatch`, `factory_review`, `factory_workflow_run` |
| REVIEWER | dispatch/review/workflow, `factory_sync`, `factory_dashboard`, `factory_memory_forget`, `factory_task_cancel` |
| RESEARCHER | file-tools (`read`/`write`/`edit`), `factory_memory_forget`, `factory_task_cancel`, `factory_sync`, `factory_dashboard` |
| SYSADMIN | все factory business-tools, кроме `factory_status`/`factory_tools_list` |
| EXECUTOR | dispatch/review/workflow, sync/dashboard, forget/cancel |
| DIRECTOR | dispatch/review/workflow, sync/dashboard, forget/cancel |

Все дочерние профили **не имеют** `factory_dispatch`, `factory_review`,
`factory_workflow_run`: внуки и рекурсивная оркестрация невозможны.

## Live-доказательство

Задача `tsk_84b3e2c0-fea9-4c56-a86e-b571164cebb9`, профиль RESEARCHER.

Дочерний агент `ses_a7143044-d4e2-4533-b19b-cdb92f659638` вызвал
`factory_memory_forget` для существующей записи:

```
TOOL_NOT_ALLOWED: factory_memory_forget не входит в allowlist профиля ребёнка
```

Запись `mem_b0e45f25-b005-42b8-b45c-d430e3b2182d` после этого осталась
доступной и активной — тело инструмента не выполнялось.

### Host capabilities (v0.17.0)

- NOFILE (`allowedTools: ["factory_status"]`): `read` → `unknown tool "read"`;
  `pwsh`/`office_read`/`run_code` не смонтированы.
- READONLY (`read` разрешён): `write` → `TOOL_NOT_ALLOWED: write ...`;
  файл не создан.
- RESEARCHER (file-tools удалены): `read` → `unknown tool "read"`.
- Прямого обхода через read/write/pwsh **не воспроизведено**. DSH не
  монтирует host file/shell tools в дочернюю сессию; guard отбивает их по
  имени, если вызов всё же отправлен.

Scoped REVIEWER (`tsk_7804a5a0...`) прошёл с `VERDICT: PASS`, дочерняя сессия
`ses_22691dae...`, задача COMPLETED.

DEVELOPER-задача `tsk_c38822b4…`, child `ses_ef302b7a…` попыталась вызвать
`factory_dispatch` (внуки/рекурсия):

```
Error: TOOL_NOT_ALLOWED: factory_dispatch не входит в allowlist профиля ребёнка
```

Вызов отклонён до выполнения; внук не создан.

Scoped workflow `tsk_fd7a9724…` завершился `PASSED` за один цикл (PASS).

## Тесты

- `plugin/tests/scoped-runner.test.ts`:
  - setup получает deny-list host-tools;
  - runtime guard возвращает `TOOL_NOT_ALLOWED` для RESEARCHER;
  - профили не содержат orchestration-tools;
  - SYSADMIN не содержит memory/task business-tools.
- `plugin/tests/dispatch.test.ts`: dispatch передаёт профиль и пустой
  allowlist запрещает запуск.
- `plugin/tests/reviewer.test.ts`: review использует scoped runner.
- Всего **50** plugin-тестов.

## Граница

Guard стоит на исполнении инструментов через `ctx.tools`. Host-возможность,
которая обходит этот реестр, вне данной модели; DSH approvals/sandbox
действуют независимо. Это зафиксировано в [SECURITY.md](../SECURITY.md).
