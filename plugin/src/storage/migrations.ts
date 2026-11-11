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
  {
    version: 2,
    name: 'orchestration: agent profiles, tasks, task events',
    sql: `
      CREATE TABLE agent_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN (
          'director', 'researcher', 'developer', 'sysadmin', 'analyst', 'executor', 'reviewer', 'custom'
        )),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        system_instruction TEXT NOT NULL DEFAULT '',
        model_provider TEXT,
        model TEXT,
        reasoning_effort TEXT,
        tools TEXT NOT NULL DEFAULT '[]',
        access_level TEXT NOT NULL DEFAULT 'workspace' CHECK (access_level IN (
          'read', 'workspace', 'elevated', 'trusted'
        )),
        memory_scope TEXT NOT NULL DEFAULT 'project' CHECK (memory_scope IN (
          'project', 'global', 'both'
        )),
        limits TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX ix_agent_profiles_role ON agent_profiles(role, enabled);

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        goal TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN (
          'NEW', 'PLANNING', 'READY', 'RUNNING', 'WAITING', 'REVIEW', 'FAILED', 'COMPLETED', 'CANCELLED'
        )),
        priority INTEGER NOT NULL DEFAULT 50,
        created_by TEXT NOT NULL,
        assigned_agent_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
        assigned_role TEXT,
        plan TEXT NOT NULL DEFAULT '[]',
        dependencies TEXT NOT NULL DEFAULT '[]',
        due_at INTEGER,
        available_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
        timeout_ms INTEGER,
        result TEXT,
        error TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        lease_owner TEXT,
        lease_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER
      );
      CREATE INDEX ix_tasks_project_status ON tasks(project_id, status, priority DESC, created_at ASC);
      CREATE INDEX ix_tasks_ready ON tasks(project_id, status, available_at);
      CREATE INDEX ix_tasks_parent ON tasks(parent_id);
      CREATE INDEX ix_tasks_agent ON tasks(assigned_agent_id, status);
      CREATE INDEX ix_tasks_lease ON tasks(status, lease_until);

      CREATE TABLE task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor TEXT,
        from_status TEXT,
        to_status TEXT,
        data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX ix_task_events_task ON task_events(task_id, ts DESC);
    `,
  },
  {
    version: 3,
    name: 'sync: outbox, cursor, remote-apply guard and memory triggers',
    sql: `
      CREATE TABLE sync_outbox (
        op_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
        payload TEXT NOT NULL,
        base_version INTEGER,
        created_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER,
        sent_at INTEGER,
        last_error TEXT
      );
      CREATE INDEX ix_sync_outbox_pending
        ON sync_outbox(sent_at, next_attempt_at, created_at);

      CREATE TABLE sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Present only inside applyRemote's transaction. Suppresses outbox
      -- triggers so remote changes are not re-uploaded.
      CREATE TABLE sync_apply_guard (
        id INTEGER PRIMARY KEY CHECK (id = 1)
      );

      CREATE TRIGGER memory_sync_insert
        AFTER INSERT ON memory_entries
        WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard)
      BEGIN
        INSERT INTO sync_outbox
          (op_id, entity_id, operation, payload, base_version, created_at)
        VALUES (
          'op_' || lower(hex(randomblob(16))),
          NEW.id,
          'upsert',
          json_object(
            'id', NEW.id,
            'projectId', NEW.project_id,
            'projectName', (SELECT name FROM projects WHERE id = NEW.project_id),
            'projectRoot', (SELECT root_path FROM projects WHERE id = NEW.project_id),
            'scope', NEW.scope,
            'kind', NEW.kind,
            'title', NEW.title,
            'content', NEW.content,
            'tags', json(NEW.tags),
            'trust', NEW.trust,
            'confidence', NEW.confidence,
            'sourceType', NEW.source_type,
            'sourceRef', NEW.source_ref,
            'agentId', NEW.agent_id,
            'sessionId', NEW.session_id,
            'status', NEW.status,
            'version', NEW.version,
            'supersedesId', NEW.supersedes_id,
            'metadata', json(NEW.metadata),
            'createdAt', NEW.created_at,
            'updatedAt', NEW.updated_at,
            'accessedAt', NEW.accessed_at,
            'expiresAt', NEW.expires_at,
            'deletedAt', NEW.deleted_at
          ),
          NULL,
          CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
        );
      END;

      CREATE TRIGGER memory_sync_update
        AFTER UPDATE OF title, content, tags, trust, confidence, metadata, status, version
        ON memory_entries
        WHEN NOT EXISTS (SELECT 1 FROM sync_apply_guard) AND NEW.version <> OLD.version
      BEGIN
        INSERT INTO sync_outbox
          (op_id, entity_id, operation, payload, base_version, created_at)
        VALUES (
          'op_' || lower(hex(randomblob(16))),
          NEW.id,
          'upsert',
          json_object(
            'id', NEW.id,
            'projectId', NEW.project_id,
            'projectName', (SELECT name FROM projects WHERE id = NEW.project_id),
            'projectRoot', (SELECT root_path FROM projects WHERE id = NEW.project_id),
            'scope', NEW.scope,
            'kind', NEW.kind,
            'title', NEW.title,
            'content', NEW.content,
            'tags', json(NEW.tags),
            'trust', NEW.trust,
            'confidence', NEW.confidence,
            'sourceType', NEW.source_type,
            'sourceRef', NEW.source_ref,
            'agentId', NEW.agent_id,
            'sessionId', NEW.session_id,
            'status', NEW.status,
            'version', NEW.version,
            'supersedesId', NEW.supersedes_id,
            'metadata', json(NEW.metadata),
            'createdAt', NEW.created_at,
            'updatedAt', NEW.updated_at,
            'accessedAt', NEW.accessed_at,
            'expiresAt', NEW.expires_at,
            'deletedAt', NEW.deleted_at
          ),
          OLD.version,
          CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
        );
      END;
    `,
  },
  {
    version: 4,
    name: 'agent scoped tool allowlists',
    sql: `
      ALTER TABLE agent_profiles ADD COLUMN allowed_tools TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 5,
    name: 'tool health overlay and history',
    sql: `
      CREATE TABLE tool_health (
        tool_name TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT '*',
        risk TEXT NOT NULL CHECK (risk IN ('R0', 'R1', 'R2')),
        status TEXT NOT NULL CHECK (status IN (
          'HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN',
          'DISABLED', 'REGISTERED', 'NOT_TESTABLE'
        )),
        source TEXT NOT NULL DEFAULT 'auto',
        last_checked_at INTEGER,
        last_ok_at INTEGER,
        latency_ms INTEGER,
        error_kind TEXT,
        error_message TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_check_at INTEGER,
        details TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (tool_name, action)
      );
      CREATE INDEX ix_tool_health_status ON tool_health(status);
      CREATE INDEX ix_tool_health_next_check ON tool_health(next_check_at);

      CREATE TABLE tool_health_history (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        checked_at INTEGER NOT NULL,
        latency_ms INTEGER,
        error_kind TEXT,
        error_message TEXT,
        details TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX ix_tool_health_history_tool
        ON tool_health_history(tool_name, action, checked_at DESC);
    `,
  },
  {
    version: 6,
    name: 'agent profile skill bindings',
    sql: `
      ALTER TABLE agent_profiles ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 7,
    name: 'capability discovery cache',
    sql: `
      CREATE TABLE capability_scans (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('host', 'project')),
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETE', 'FAILED')),
        scanner_version TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        counts TEXT NOT NULL DEFAULT '{}',
        error TEXT
      );
      CREATE INDEX ix_capability_scans_scope
        ON capability_scans(scope, project_id, started_at DESC);

      CREATE TABLE capabilities (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('host', 'project')),
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        capability_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT,
        version TEXT,
        version_source TEXT NOT NULL DEFAULT 'unknown'
          CHECK (version_source IN ('file', 'probe', 'none', 'unknown')),
        status TEXT NOT NULL
          CHECK (status IN ('AVAILABLE', 'UNAVAILABLE', 'STALE', 'UNKNOWN', 'DISABLED')),
        confidence REAL NOT NULL DEFAULT 0,
        details TEXT NOT NULL DEFAULT '{}',
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX ux_capabilities_key
        ON capabilities(scope, ifnull(project_id, ''), capability_id);
      CREATE INDEX ix_capabilities_status ON capabilities(status, expires_at);
    `,
  },
  {
    version: 8,
    name: 'knowledge base',
    sql: `
      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        mime TEXT,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'INDEXED', 'FAILED', 'DELETED')),
        error TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        indexed_at INTEGER,
        UNIQUE(project_id, path)
      );
      CREATE INDEX ix_knowledge_documents_project
        ON knowledge_documents(project_id, status);

      CREATE TABLE knowledge_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        heading TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        token_estimate INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        embedding BLOB,
        embedding_model TEXT,
        embedding_dim INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(document_id, ordinal)
      );
      CREATE INDEX ix_knowledge_chunks_project ON knowledge_chunks(project_id);
      CREATE INDEX ix_knowledge_chunks_document ON knowledge_chunks(document_id, ordinal);

      CREATE VIRTUAL TABLE knowledge_fts USING fts5(
        text,
        heading,
        content='knowledge_chunks',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
        INSERT INTO knowledge_fts(rowid, text, heading) VALUES (new.rowid, new.text, new.heading);
      END;
      CREATE TRIGGER knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, text, heading) VALUES ('delete', old.rowid, old.text, old.heading);
      END;
      CREATE TRIGGER knowledge_chunks_au AFTER UPDATE ON knowledge_chunks BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, text, heading) VALUES ('delete', old.rowid, old.text, old.heading);
        INSERT INTO knowledge_fts(rowid, text, heading) VALUES (new.rowid, new.text, new.heading);
      END;
    `,
  },
  {
    version: 9,
    name: 'safety policy, task trajectory and improvement candidates',
    sql: `
      ALTER TABLE agent_profiles ADD COLUMN egress TEXT NOT NULL DEFAULT 'none'
        CHECK (egress IN ('none', 'read', 'write'));

      CREATE TABLE task_steps (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        ok INTEGER NOT NULL,
        error_code TEXT,
        duration_ms INTEGER,
        created_at INTEGER NOT NULL,
        UNIQUE(task_id, seq)
      );
      CREATE INDEX ix_task_steps_task ON task_steps(task_id, seq);

      CREATE TABLE improvement_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'WRITTEN')),
        skill_id TEXT,
        draft_markdown TEXT,
        evidence TEXT NOT NULL DEFAULT '{}',
        reviewer_verdict TEXT,
        reviewer_notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, source_task_id)
      );
      CREATE INDEX ix_improvement_candidates_project
        ON improvement_candidates(project_id, status, updated_at DESC);
    `,
  },
]
