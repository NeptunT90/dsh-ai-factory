# Capability Discovery (BLOCK 4)

Capability discovery is a **host inventory cache**, not a permission system and
not a replacement for tool health. It answers questions such as "есть ли Java,
Docker, Python или нужный SDK?" before the Director/Planner create work.

## Safety defaults

```text
capabilityScanEnabled = false   # no automatic scan
capabilityProbeMode   = off     # filesystem detection only
```

The plugin does **not** scan at startup, on `factory_status`, on
`factory_capability_list/get/check`, or while planning. Only an explicit
`factory_capability_scan` / `factory_capability_refresh` writes a new scan.

With `capabilityProbeMode=off` no process is started. The detector only:

- reads PATH and standard OS directories;
- resolves canonical files;
- checks `JAVA_HOME/release` for a Java version;
- never runs installers, package managers, build tools or `docker`.

With `capabilityProbeMode=safe` the **fixed** argv from the static registry may be
run with:

- `shell:false`;
- absolute executable path;
- timeout `capabilityTimeoutMs` (default 3 s);
- output cap `capabilityMaxOutputBytes` (default 4 KiB);
- minimal environment without tokens/proxies/Docker credentials.

Windows `.cmd`/`.bat` files are never probed. Docker is **presence-only** and
never gets `docker --version` or `docker info`.

## Definitions (v1)

`node`, `python`, `java`, `docker`, `git`, `maven`, `gradle`, `dotnet`, `go`,
`rust`, `npm`, `pnpm`, `pip`, `uv`.

Each definition is static. Users cannot add a command, path or argument.

## Cache

SQLite schema v7:

```text
capability_scans
  id, scope, project_id, status, scanner_version,
  started_at, finished_at, counts, error

capabilities
  id, scope, project_id, capability_id, kind,
  path, version, version_source, status,
  confidence, details, last_seen_at, expires_at, updated_at
```

- TTL: **6 hours** (`capabilityTtlHours`).
- scope: `host` (current implementation); `project` reserved for local SDKs.
- statuses: `AVAILABLE`, `UNAVAILABLE`, `STALE`, `UNKNOWN`, `DISABLED`.
- `details` is safe metadata only: no env values, stdout/stderr or secrets.
- Stale is computed on read; `list/get/check` do not rewrite the cache.

## Tools

All are root-only and are not available to child profiles.

| Tool | Risk | Behavior |
|---|---|---|
| `factory_capability_scan` | R1 | explicit full host scan, writes cache |
| `factory_capability_list` | R0 | cache-only list |
| `factory_capability_get` | R0 | cache-only one record |
| `factory_capability_check` | R0 | requirements check, **cache-only** |
| `factory_capability_refresh` | R1 | explicit refresh, writes cache |

If the cache is empty, `check` returns `UNKNOWN`.
If the cache has expired records, it returns `STALE`.
Neither case triggers a scan or refresh.

## Using requirements

### Check directly

```text
factory_capability_check({
  requirements: [
    { id: "node" },
    { id: "docker" }
  ]
})
```

### Plan

```text
factory_plan_create({
  goal: "Build and test the service",
  steps: [{
    key: "build",
    title: "Build service",
    requiresCapabilities: ["node", "docker"]
  }]
})
```

The Planner checks requirements **before creating the parent task or step
tasks**. Missing/stale/unknown capability → `CAPABILITY_MISSING`; no plan rows
are created.

### Task

```text
factory_task_create({
  title: "Run integration tests",
  requiresCapabilities: ["node"]
})
```

Requirements are stored in task metadata. Dispatch re-checks them **before
claim and child creation**; missing/stale → `CAPABILITY_MISSING`, task remains
READY.

## Director

`factory_director_brief` includes a cache summary:

```text
capabilities: 8 available · 6 unavailable · 0 stale · 0 unknown
```

The summary never scans. A DIRECTOR prompt should call
`factory_capability_check` before planning and request an explicit scan when the
answer is `UNKNOWN` or `STALE`.

## Security boundary

- A capability being available does **not** grant a tool. `allowedTools` and the
  runtime tool guard remain the only enforcement.
- Scan is root-only; results are not exposed to child agents.
- Paths are canonicalized; only static binary names and trusted roots are used.
- No shell, no user arguments, no installation, no configuration changes.
- Docker daemon and Docker credentials are never accessed.
- Secret-like env/config values are never stored.
- A stale cache is not treated as available.

## Out of scope

- automatic scan/refresh;
- network checks;
- installation or version management;
- project-local SDK probing (`project` scope reserved);
- arbitrary executables or user-provided commands;
- using capability availability as a tool permission grant.
