# Backups (BLOCK 6)

## Local backup

`scripts/backup.ps1` produces:

```text
backups/factory-<timestamp>/
  factory.db
  manifest.json
  config.json / settings.json   (optional)
  profile/                      (profile config)
backups/factory-<timestamp>.tar.gz
```

The archive contains `manifest.json` and `factory.db` at its root.

`manifest.json`:

```json
{
  "format": "factory.backup/v1",
  "pluginVersion": "0.23.0",
  "schemaVersion": 7,
  "createdAt": "2026-11-11T...",
  "source": "local",
  "tables": [
    { "name": "agent_profiles", "rows": 11, "sha256": "..." }
  ],
  "files": [
    { "path": "profile/package.json", "bytes": 123, "sha256": "..." }
  ],
  "database": {
    "path": "factory.db",
    "bytes": 663552,
    "sha256": "..."
  }
}
```

`scripts/backup-manifest.mjs` generates the manifest from a consistent SQLite
snapshot. Table hashes use canonical sorted-key JSON rows.

## Verification

`factory_backup_verify` is root-only and reads only archives under
`<project>/backups` or `<dataDir>/backups`.

Checks:

- `.tar.gz` gzip magic;
- safe tar entries (no traversal/symlinks/oversized unpack);
- `manifest.json` schema and `factory.db` size/hash;
- SQLite `quick_check` through an in-memory connection with the archive DB
  attached;
- schema version and every table row count/hash.

`factory_backup_restore_test` additionally extracts a copy under the system temp
directory, reads agent/task/memory counts, and removes the temp directory in
every path.

## Server backup

The sync server's `BackupScheduler` writes:

- `*.tar.gz` — PGlite dump;
- `*.sha256`;
- `*.manifest.json` — server backup manifest with archive hash and table
  summaries.

`GET /v1/admin/backup` also returns `X-Backup-Manifest` (base64 JSON) and
`X-Backup-Schema-Version`; `scripts/server-backup.ps1` saves the sidecar when
the header is present.

## Safety

- All backup management tools are root-only.
- Temporary restores are always deleted.
- Archives outside the allowed backup roots are rejected.
- A corrupt or hash-mismatched archive is reported as invalid, never restored
  into the live database.
