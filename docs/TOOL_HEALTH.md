# Tool Health Check (BLOCK 1)

Health-слой для **только `factory_*` инструментов**.

Текущий registry: **53 factory tools / 61 actions** (плюс 3 health tools = **56** зарегистрированных инструментов). Host-tools DSH
(`read`, `write`, `pwsh`, `browser_*`, `office_*`, `ssh_*`) находятся вне
зоны плагина: им не ставится ни `UNAVAILABLE`, ни `NOT_TESTABLE`, ни
`UNKNOWN`, они не фильтруются в `effectiveAllowedTools`.

## Статусы

| Статус | Кому | Значение |
|---|---|---|
| `HEALTHY` | R0 | Реальный safe probe через `ctx.tools.execute` успешен |
| `DEGRADED` | mixed/R0 | Некоторые R0 недоступны, либо latency ≥ 2 000 ms |
| `UNAVAILABLE` | R0 / отсутствующий tool | Probe упал или tool отсутствует в registry |
| `UNKNOWN` | R0 | Нет фикстуры, hidden side effect, PIPE/PTC не выполнил probe |
| `DISABLED` | любой `factory_*` | Явно отключён |
| `REGISTERED` | **только R1** | Зарегистрирован, схема валидна, execute не вызывался |
| `NOT_TESTABLE` | **только R2** | Нельзя безопасно проверить без реального действия |

`REGISTERED` не означает «работает»:

> **REGISTERED = инструмент зарегистрирован, схема валидна, runtime-зависимости (БД, сеть, порт) НЕ проверялись.**

Для R1 `factory_tool_health` возвращает `source: "schema"` и
`details.dependenciesChecked: false`, `details.dependenciesScope: "BLOCK_4"`.
Проверка зависимостей — BLOCK 4 (Capability Discovery).

R2 (`factory_dispatch`, `factory_review`, `factory_workflow_run`,
`factory_sync push/pull/sync`, `factory_auto_workflow run/start`) никогда не
вызывается health-чекером и получает `NOT_TESTABLE`.

## R0: pure probe и observed

Pure R0 вызываются реально через **`ctx.tools.execute`** (DSH tool batch
pipeline: pre-execute, approval, guard, timeout), а не через
`ToolDefinition.execute`.

Observed R0 помечаются `UNKNOWN` с причиной, потому что их тело имеет
запись:

> **`factory_memory_search`, `factory_task_list`, `factory_task_get`,
> `factory_task_events`, `factory_task_stats`, `factory_director_brief`
> помечены `UNKNOWN`, потому что их probe пишет в `audit_log` или
> `projects.updated_at`; real probe — TODO после BLOCK 1.**

`factory_status` и другие pure R0 проверяются реально.

## Risk registry

| tool | action | risk | mode |
|---|---|---|---|
| factory_status | * | R0 | probe |
| factory_memory_remember | * | R1 | schema |
| factory_memory_search | * | R0 | observed |
| factory_memory_get | * | R0 | probe |
| factory_memory_update | * | R1 | schema |
| factory_memory_forget | * | R1 | schema |
| factory_memory_history | * | R0 | probe |
| factory_memory_stats | * | R0 | probe |
| factory_agent_list | * | R0 | probe |
| factory_agent_get | * | R0 | probe |
| factory_agent_save | * | R1 | schema |
| factory_agent_toggle | * | R1 | schema |
| factory_agent_export | * | R1 | schema |
| factory_agent_import | * | R1 | schema |
| factory_agent_validate | * | R0 | observed |
| factory_skill_list | * | R0 | probe |
| factory_skill_get | * | R0 | observed |
| factory_skill_validate | * | R0 | probe |
| factory_skill_create | * | R1 | schema |
| factory_skill_update | * | R1 | schema |
| factory_skill_delete | * | R1 | schema |
| factory_skill_assign | * | R1 | schema |
| factory_capability_scan | * | R1 | schema |
| factory_capability_list | * | R0 | probe |
| factory_capability_get | * | R0 | observed |
| factory_capability_check | * | R0 | probe |
| factory_capability_refresh | * | R1 | schema |
| factory_backup_verify | * | R0 | observed |
| factory_backup_restore_test | * | R1 | schema |
| factory_task_create | * | R1 | schema |
| factory_task_list | * | R0 | observed |
| factory_task_get | * | R0 | observed |
| factory_task_update | * | R1 | schema |
| factory_task_claim | * | R1 | schema |
| factory_task_heartbeat | * | R1 | schema |
| factory_task_review | * | R1 | schema |
| factory_task_complete | * | R1 | schema |
| factory_task_fail | * | R1 | schema |
| factory_task_cancel | * | R1 | schema |
| factory_task_retry | * | R1 | schema |
| factory_task_recover | * | R1 | schema |
| factory_task_events | * | R0 | observed |
| factory_task_stats | * | R0 | observed |
| factory_plan_create | * | R1 | schema |
| factory_director_brief | * | R0 | observed |
| factory_tools_list | * | R0 | probe |
| factory_dispatch | * | R2 | not_testable |
| factory_dashboard | status | R0 | probe |
| factory_dashboard | start | R1 | schema |
| factory_dashboard | stop | R1 | schema |
| factory_sync | status | R0 | probe |
| factory_sync | push | R2 | not_testable |
| factory_sync | pull | R2 | not_testable |
| factory_sync | sync | R2 | not_testable |
| factory_review | * | R2 | not_testable |
| factory_workflow_run | * | R2 | not_testable |
| factory_model_route | * | R0 | probe |
| factory_auto_workflow | status | R0 | probe |
| factory_auto_workflow | stop | R1 | schema |
| factory_auto_workflow | run | R2 | not_testable |
| factory_auto_workflow | start | R2 | not_testable |

`factory_tool_health`, `factory_tool_health_check`,
`factory_tool_health_history` **не входят** в registry: health не проверяет
сам себя (защита от рекурсии).

## Mixed aggregate

- `UNAVAILABLE` — только если **все** действия инструмента `UNAVAILABLE` /
  `DISABLED`; только тогда удалять из `effectiveAllowedTools`.
- Если R0-действие `UNAVAILABLE`, но остальные действия
  `REGISTERED`/`NOT_TESTABLE` — aggregate `DEGRADED`, инструмент **не
  удалять**.
- Если R0 `HEALTHY`, R2 `NOT_TESTABLE` — aggregate `HEALTHY`, action-level
  R2 остаётся `NOT_TESTABLE`.

Пример: `factory_sync status=UNAVAILABLE`, `push/pull/sync=NOT_TESTABLE`
→ `DEGRADED`, не удалять. Всё `UNAVAILABLE` → удалить.

## ProbeRunner

`DshProbeRunner` (`plugin/src/health/probe.ts`) вызывает:

- `ctx.tools.execute({ calls: [ToolCallBlock], signal, agent, maxParallelToolCalls: 1 })`;
- `ToolCallBlock.arguments` — JSON-строка;
- без `log` (нет записи tool/call/tool/result в сессию);
- без `toolSet` (factory tools безусловны).

Это проходит `ToolsService.selectExecutor` → `ToolExecutionPipeline` →
`tools/pre-execute` / approval / `checkGuards` → dispatch.

Fallback на `definition.execute` **запрещён**. Если pipeline/executor
недоступен (PTC, no executor), статус `UNKNOWN`, не `UNAVAILABLE`.

## Circuit breaker / TTL

- TTL: 600 000 ms.
- R0: 3 подряд `UNAVAILABLE` → `UNAVAILABLE`, `next_check_at = now+300000`.
- После cooldown — контрольный R0-probe; успех сбрасывает failures.
- R1/R2 никогда не участвуют в breaker.
- `INVALID_INPUT`/`NOT_FOUND`/`UNKNOWN_TOOL` → `UNKNOWN`, не `UNAVAILABLE`.

## Инструменты

| Инструмент | Назначение |
|---|---|
| `factory_tool_health` | список health/risk/actions; read-only |
| `factory_tool_health_check` | R0 probe, R1 schema, R2 not-testable; root-only |
| `factory_tool_health_history` | история проверок; root-only |

Все три не входят в child allowlists.

## Dashboard

`/api/state` отдаёт `tools` с `risk`, `healthStatus`, `healthSource`,
`healthCheckedAt`, `latencyMs`, `errorKind`, `dependenciesChecked`.
Host-tools показываются как `DSH-managed`, без health-статуса.
Статический `CAPABILITIES` не является health.

## Безопасность

`factory_agent_save` — отдельный риск BLOCK 2/Security: child не должен
выдавать `allowedTools`, включая `factory_dispatch`. План: root-only по
умолчанию, позже `adminTools`, принцип «нельзя выдать больше, чем имеешь»,
и audit `agent.grant_denied`.
