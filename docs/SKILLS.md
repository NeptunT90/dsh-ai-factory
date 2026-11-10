# Skills (BLOCK 3)

Project-local skills are Markdown files in:

```text
<project.rootPath>/.skills/<id>.md
```

They are **instructions**, not permissions. A skill can never add or remove a
tool from `allowedTools`. Tool access is enforced separately by the child
agent's profile allowlist and the runtime tool guard.

## File format

```markdown
---
apiVersion: factory.skill/v1
id: code-review
name: Code Review
description: Review a diff for regressions and missing tests
version: 1
roles: [developer, reviewer]
priority: 50
enabled: true
---

# Instructions

Review the diff. Report blocking regressions, missing tests and residual risks.
```

The file name is authoritative: `code-review.md` must contain
`id: code-review`.

### Frontmatter fields

| Field | Required | Rule |
|---|---|---|
| `apiVersion` | yes | exactly `factory.skill/v1` |
| `id` | yes | `^[a-z0-9][a-z0-9-]{1,63}$`, matches file name |
| `name` | yes | 1..100 characters |
| `description` | yes | 1..500 characters |
| `version` | yes | integer ≥ 1 |
| `roles` | yes | non-empty subset of agent roles, no duplicates |
| `priority` | yes | integer 0..100 |
| `enabled` | yes | boolean |

### Forbidden fields

These are rejected with `SKILL_INVALID`:

- `allowedTools`
- `tools`
- `complete`
- `order`
- `systemPrompt`
- `prompt`

Unknown keys are also rejected. Skills cannot replace the complete system
prompt, cannot register tool schemas, and cannot alter tool permissions.

## Limits

| Limit | Value |
|---|---:|
| Body | 1 byte .. 16 KiB |
| Frontmatter | max 4 KiB |
| Files per project | max 50 |
| Total body bytes | max 64 KiB |
| Skill id length | 2..64 characters |

Additional checks:

- strict UTF-8, no NUL/binary control characters;
- body must be non-empty;
- secret-like material is rejected (`SKILL_SECRET_DETECTED`);
- only regular files: symlinks, subdirectories and path traversal are rejected;
- the whole store is restricted to `<project.rootPath>/.skills/`;
- `.skills` itself must be a normal directory.

## Prompt hierarchy

When a child is created, `ScopedChildRunner.setup` registers:

| Contribution | Name | Order | Interpolation |
|---|---|---:|---|
| Profile instruction | `factory:profile:<profileId>` | `4000` | off |
| Skill | `factory:skill:<id>` | `6000 + priority` | off |

The resulting authority order is:

```text
Harness system prompt
  → Profile (system)
  → Skills (system)
  → Task (user)
```

The task/user prompt cannot override profile or skill instructions. Skills are
registered with `interpolate: false`; `complete: true` is never used.

If `ctx.systemPrompt` is unavailable, child creation fails closed. If any
assigned skill is missing, invalid or disabled, `SkillService.resolve` throws
`SKILL_NOT_FOUND` **before claim/child creation**. There is no silent skip.

`composePrompt` no longer contains `systemInstruction`; task text contains only
project/task/goal/dependencies/plan and untrusted memory context.

## Assigning a skill

Root-only:

```text
factory_skill_assign(agentId, skillId, action: "attach" | "detach")
```

Or via:

```text
factory_agent_save(id, skills: ["skill-id"])
```

`factory_agent_save`:

- validates every skill id in the caller's current project;
- does **not** change `allowedTools`;
- writes audit `agent.skills_changed` with `oldSkillIds` / `newSkillIds`.

Built-in profiles cannot be modified or disabled. A caller cannot modify a
profile with a higher `accessLevel`. Profiles use the global
`agent_profiles.skills` JSON array (migration v6).

## Management tools

All are root-only and are not available to child agents:

| Tool | Risk | Behavior |
|---|---|---|
| `factory_skill_list` | R0 | list metadata and hashes |
| `factory_skill_get` | R0 observed | metadata + body |
| `factory_skill_validate` | R0 | validate one/all, no writes |
| `factory_skill_create` | R1 | atomic temp+rename create |
| `factory_skill_update` | R1 | update with `expectedHash` |
| `factory_skill_delete` | R1 | delete file |
| `factory_skill_assign` | R1 | attach/detach on a profile |

`factory_skill_get` has no safe fixed-id health fixture, so health reports it
as `UNKNOWN` rather than calling it blindly.

## Out of scope

- root-agent skills are not supported in BLOCK 3;
- global `~/.dsh/` skills are not supported;
- project-scoped sync of skill files is not implemented;
- child writes to `.skills` remain governed by the DSH sandbox, not by a plugin
  path guard.
