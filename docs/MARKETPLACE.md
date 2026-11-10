# Agent Marketplace (BLOCK 5)

Portable agent profiles live in the project root:

```text
<project.rootPath>/.agents/<slug>.json
```

The slug is derived from the profile name (`Code Reviewer` → `code-reviewer`).
Internal database ids (`agt_...`), `isBuiltin`, version and timestamps are never
exported.

## File format

```json
{
  "format": "factory.agent/v1",
  "id": "code-reviewer",
  "exportedAt": 1790000000000,
  "profile": {
    "name": "Code Reviewer",
    "role": "reviewer",
    "title": "Code Reviewer",
    "description": "Reviews diffs",
    "systemInstruction": "...",
    "modelProvider": null,
    "model": null,
    "reasoningEffort": null,
    "tools": [],
    "allowedTools": ["read", "grep"],
    "skills": ["code-review"],
    "accessLevel": "workspace",
    "memoryScope": "project",
    "limits": {
      "maxConcurrentTasks": 2,
      "maxAttempts": 3,
      "timeoutMs": 900000,
      "autonomy": "autonomous"
    },
    "enabled": true
  }
}
```

- `tools` is advisory only; it is preserved as an array of strings.
- `allowedTools` is enforcement data and is checked on import.
- unknown fields are rejected.

## Tools

All tools are root-only and are absent from child allowlists:

| Tool | Risk | Behavior |
|---|---|---|
| `factory_agent_export` | R1 | writes `.agents/<slug>.json` atomically |
| `factory_agent_import` | R1 | validates and creates a new custom profile |
| `factory_agent_validate` | R0 observed | validates without writing |

## Export

- any custom or built-in profile may be exported as a template;
- system ids, `isBuiltin`, version and timestamps are removed;
- `detectSecrets()` runs on name/title/description/systemInstruction and the
  full JSON; if it finds a secret-like value, export fails with
  `SECRET_DETECTED` and no file is written;
- writes are temp-file + rename inside `.agents`;
- symlinks and path traversal are rejected;
- max file size: 128 KiB.

## Import

Import always creates a **new custom profile** with a new internal `agt_...` id.

Checks:

1. `allowedTools ⊆ caller's visible tools`.
   A child cannot use marketplace tools at all; a root caller cannot grant a tool
   it does not have.
2. `accessLevel` must not be higher than the caller's access level.
3. Every `skills` id must exist and be enabled in the current project.
4. Name collision → `CONFLICT`; pass `name` to override.
5. Built-in `isBuiltin`/internal ids are rejected.
6. Secrets → `SECRET_DETECTED`.
7. Invalid format/JSON/path → `INVALID_INPUT`.

Built-in export is a template: importing `director.json` without a name override
fails because `DIRECTOR` already exists; `name: "DIRECTOR_TEMPLATE"` succeeds.

## Live constraint

A profile is global in SQLite, while `.agents` and skills are project-local.
Import validates skills against the **current project**; using the imported
profile in another project still follows normal skill resolution and may fail
closed if the skill is absent there.

## Security

- Export/import are root-only.
- exported profiles omit internal IDs and secrets;
- imported profiles never widen `allowedTools`;
- imported `accessLevel` is bounded by the caller;
- children cannot call marketplace tools even if a custom allowlist names them;
- `.agents` writes remain under the DSH sandbox; the plugin only enforces the
  project-relative path and root-only management.
