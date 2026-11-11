# Autonomy and Safety Policy (v0.28.0)

## Modes

`agent_profiles.limits.autonomy` is enforced:

| Mode | Local read | Local write/tests | Shell | Network |
|---|---:|---:|---:|---:|
| SAFE | yes | no | no | no |
| AUTONOMOUS | yes | yes | restrictive | per `egress` |
| TRUSTED | yes | yes | restrictive | per `egress` |

`egress` is a separate profile field: `none | read | write`.

- `DIRECTOR`, `RESEARCHER`, `EXECUTOR`: `read` egress.
- `SYSADMIN`: `write` egress; `ssh_*` remains explicit-tool-only.
- `DEVELOPER`, `REVIEWER`, `REPAIRER`, `ANALYST`, `CONCIERGE`, `CURATOR`: `none`.

## Enforcement

`ctx.tools.guard` receives parsed arguments. `SafetyPolicy` evaluates:

- tool allowlist;
- autonomy/accessLevel;
- egress;
- project-root path boundary;
- shell command deny-list.

Denials are immediate, with no approval prompt:

```text
SECURITY_VIOLATION: <rule>: <message>
```

and an audit record `security.violation` (rule + tool, never raw arguments).

Blocked examples:

- `git push --force` / `-f` / `--force-with-lease`;
- `rm -rf /`, root/disk destructive commands;
- delete/write `factory.db` or `ai-factory`;
- `curl -X POST --data`, upload flags;
- SSH/SCP from a shell (explicit ssh tools follow egress);
- writes outside project root;
- SAFE shell/write/network;
- `run_code` outside TRUSTED.

Allowed examples in AUTONOMOUS: `pnpm test`, `git status`, local writes under
the project root.

## Honest limitation

Shell is not a sandbox. The deny-list is best-effort and can be bypassed by
obfuscation, scripts, package hooks, or new binaries. Full protection requires
the DSH/OS sandbox and an egress boundary. The plugin does not claim absolute
shell containment.
