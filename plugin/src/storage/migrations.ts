/** Ordered SQLite migrations. Never edit a released migration; append a new one. */
export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'foundation: projects, memory, versions, audit, fts',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        description TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE memory_entries (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        scope TEXT NOT NULL CHECK (scope IN ('project', 'global')),
        kind TEXT NOT NULL CHECK (kind IN ('working', 'episodic', 'semantic', 'project', 'user')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        tags_text TEXT NOT NULL DEFAULT '',
        trust TEXT NOT NULL CHECK (trust IN ('verified', 'user_confirmed', 'unverified', 'inferred')),
        confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
        source_type TEXT NOT NULL CHECK (source_type IN ('user', 'agent', 'tool', 'import', 'system')),
        source_ref TEXT,
        agent_id TEXT,
        session_id TEXT,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'deleted')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        supersedes_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        accessed_at INTEGER,
        expires_at INTEGER,
        deleted_at INTEGER,
        CHECK (scope = 'global' OR project_id IS NOT NULL)
      );

      CREATE UNIQUE INDEX ux_memory_active_dedupe
        ON memory_entries(ifnull(project_id, ''), kind, content_hash)
        WHERE status = 'active';

      CREATE INDEX ix_memory_project_status_updated
        ON memory_entries(project_id, status, updated_at DESC);
      CREATE INDEX ix_memory_kind_status
        ON memory_entries(kind, status);
      CREATE INDEX ix_memory_expiry
        ON memory_entries(status, expires_at);

      CREATE TABLE memory_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        change_reason TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(entry_id, version)
      );
      CREATE INDEX ix_memory_versions_entry
        ON memory_versions(entry_id, version DESC);

      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
        event TEXT NOT NULL,
        actor TEXT,
        project_id TEXT,
        session_id TEXT,
        data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX ix_audit_ts ON audit_log(ts DESC);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE memory_fts USING fts5(
        title,
        content,
        tags_text,
        content = 'memory_entries',
        content_rowid = 'rowid',
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER memory_fts_insert AFTER INSERT ON memory_entries BEGIN
        INSERT INTO memory_fts(rowid, title, content, tags_text)
        VALUES (new.rowid, new.title, new.content, new.tags_text);
      END;

      CREATE TRIGGER memory_fts_delete AFTER DELETE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, content, tags_text)
        VALUES ('delete', old.rowid, old.title, old.content, old.tags_text);
      END;

      CREATE TRIGGER memory_fts_update
        AFTER UPDATE OF title, content, tags_text ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, title, content, tags_text)
        VALUES ('delete', old.rowid, old.title, old.content, old.tags_text);
        INSERT INTO memory_fts(rowid, title, content, tags_text)
        VALUES (new.rowid, new.title, new.content, new.tags_text);
      END;
    `,
  },
]
