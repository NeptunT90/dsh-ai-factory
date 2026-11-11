# Self-Improvement (v0.28.1)

## Implementation reality (v1)

The v1 pipeline uses a **deterministic template**, not an LLM analysis call. It
derives a skill skeleton from the task title/description/goal and sanitized tool
metadata. It does not invoke the CURATOR profile as a model and does not invoke
a separate REVIEWER model. The `factory_improve_apply` gate applies strict
schema/secret/injection validation before writing; a model-based CURATOR/REVIEWER
pass is a future enhancement, not current behavior.

## Trigger

Only an explicit root call:

```text
factory_improve_task(taskId)
```

Requirements:

- task is `COMPLETED`;
- `attempts >= 3`;
- one candidate per task (`UNIQUE(project_id, source_task_id)`).

No automatic trigger and no automatic file write.

## Pipeline

```text
COMPLETED task + attempts >= 3
  -> factory_improve_task
  -> improvement_candidates DRAFT
  -> factory_improve_apply (root-only review + write gate)
  -> .skills/<id>.md
```

`factory_improve_task` generates a CURATOR-shaped draft from:
task title/description/goal, tool names, success/error metadata, attempts.
It does **not** store prompts, arguments, tool content or chain-of-thought.

## Review and apply

`factory_improve_apply` is the REVIEWER gate:

- YAML/frontmatter/schema validation;
- secret detection;
- prompt-injection marker detection;
- no tool widening;
- bounded skill body.

Only PASS writes `.skills/<id>.md`; FAIL marks `REJECTED`, sets
`reviewer_verdict = FAIL`, and leaves no file. The skill is not assigned to any
profile automatically.

## Storage

```text
task_steps                 tool name, ok, error_code, duration_ms, seq
improvement_candidates     draft, evidence, status, reviewer verdict
.skills/<id>.md            only after apply
```

Raw prompts, tool arguments and tool outputs are not stored.

## CURATOR

Built-in CURATOR is read-only:

```text
read
factory_task_get
factory_task_events
factory_skill_list
factory_skill_validate
factory_memory_search
```

It has no write/network tools and no skill assignment rights.
