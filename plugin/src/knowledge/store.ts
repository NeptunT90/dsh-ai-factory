import type { FactoryDatabase } from '../storage/database.js'
import { now } from '../core/ids.js'
import type { KnowledgeChunkInput, KnowledgeDocument, KnowledgeSearchHit } from './types.js'

interface DocumentRow {
  id: string
  project_id: string
  path: string
  title: string
  mime: string | null
  size: number
  sha256: string
  status: KnowledgeDocument['status']
  error: string | null
  metadata: string
  created_at: number
  updated_at: number
  indexed_at: number | null
  chunks?: number
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function mapDocument(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    title: row.title,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    status: row.status,
    error: row.error,
    metadata: parseObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    indexedAt: row.indexed_at,
    chunks: Number(row.chunks ?? 0),
  }
}

function ftsQuery(query: string): string {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 20)
  if (terms.length === 0) return ''
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ')
}

export class KnowledgeStore {
  constructor(private readonly db: FactoryDatabase) {}

  list(projectId: string, options: { status?: KnowledgeDocument['status']; limit?: number } = {}): KnowledgeDocument[] {
    const where = ['d.project_id = ?']
    const params: Array<string | number> = [projectId]
    if (options.status !== undefined) {
      where.push('d.status = ?')
      params.push(options.status)
    }
    if (options.status === undefined) where.push("d.status != 'DELETED'")
    params.push(Math.max(1, Math.min(200, Math.floor(options.limit ?? 100))))
    return this.db
      .all<DocumentRow>(
        `SELECT d.*, (SELECT count(*) FROM knowledge_chunks c WHERE c.document_id = d.id) AS chunks
         FROM knowledge_documents d WHERE ${where.join(' AND ')}
         ORDER BY d.path ASC LIMIT ?`,
        params,
      )
      .map(mapDocument)
  }

  get(projectId: string, documentId: string): KnowledgeDocument | undefined {
    const row = this.db.get<DocumentRow>(
      `SELECT d.*, (SELECT count(*) FROM knowledge_chunks c WHERE c.document_id = d.id) AS chunks
       FROM knowledge_documents d WHERE d.project_id = ? AND d.id = ?`,
      [projectId, documentId],
    )
    return row ? mapDocument(row) : undefined
  }

  findByPath(projectId: string, path: string): KnowledgeDocument | undefined {
    const row = this.db.get<DocumentRow>(
      `SELECT d.*, (SELECT count(*) FROM knowledge_chunks c WHERE c.document_id = d.id) AS chunks
       FROM knowledge_documents d WHERE d.project_id = ? AND d.path = ?`,
      [projectId, path],
    )
    return row ? mapDocument(row) : undefined
  }

  beginDocument(input: {
    id: string
    projectId: string
    path: string
    title: string
    mime: string | null
    size: number
    sha256: string
    metadata?: Record<string, unknown>
  }): KnowledgeDocument {
    const existing = this.findByPath(input.projectId, input.path)
    const ts = now()
    if (existing) {
      this.db.run(
        `UPDATE knowledge_documents
         SET title = ?, mime = ?, size = ?, sha256 = ?, status = 'PENDING', error = NULL,
             metadata = ?, updated_at = ?
         WHERE id = ?`,
        [input.title, input.mime, input.size, input.sha256, JSON.stringify(input.metadata ?? {}), ts, existing.id],
      )
      return this.get(input.projectId, existing.id)!
    }
    this.db.run(
      `INSERT INTO knowledge_documents
        (id, project_id, path, title, mime, size, sha256, status, error, metadata, created_at, updated_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, ?, NULL)`,
      [input.id, input.projectId, input.path, input.title, input.mime, input.size, input.sha256, JSON.stringify(input.metadata ?? {}), ts, ts],
    )
    return this.get(input.projectId, input.id)!
  }

  replaceChunks(documentId: string, projectId: string, chunks: readonly KnowledgeChunkInput[]): void {
    const ts = now()
    this.db.transaction(() => {
      this.db.run('DELETE FROM knowledge_chunks WHERE document_id = ?', [documentId])
      for (const chunk of chunks) {
        this.db.run(
          `INSERT INTO knowledge_chunks
            (id, document_id, project_id, ordinal, heading, text, char_start, char_end,
             token_estimate, content_hash, embedding, embedding_model, embedding_dim, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
          [
            `kch_${documentId.slice(4)}_${chunk.ordinal}`,
            documentId,
            projectId,
            chunk.ordinal,
            chunk.heading,
            chunk.text,
            chunk.charStart,
            chunk.charEnd,
            chunk.tokenEstimate,
            chunk.contentHash,
            ts,
          ],
        )
      }
      this.db.run(
        "UPDATE knowledge_documents SET status = 'INDEXED', error = NULL, indexed_at = ?, updated_at = ? WHERE id = ?",
        [ts, ts, documentId],
      )
    })
  }

  markFailed(documentId: string, error: string): void {
    this.db.run(
      "UPDATE knowledge_documents SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?",
      [error.slice(0, 1000), now(), documentId],
    )
  }

  /** Soft-delete a document and remove its chunks (FTS triggers maintain the index). */
  delete(projectId: string, documentId: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM knowledge_chunks WHERE document_id = ? AND project_id = ?', [documentId, projectId])
      this.db.run(
        "UPDATE knowledge_documents SET status = 'DELETED', updated_at = ? WHERE id = ? AND project_id = ?",
        [now(), documentId, projectId],
      )
    })
  }

  search(projectId: string, query: string, limit = 8): KnowledgeSearchHit[] {
    const match = ftsQuery(query)
    if (match === '') return []
    const rows = this.db.all<{
      chunk_id: string
      document_id: string
      project_id: string
      path: string
      title: string
      heading: string
      snippet: string
      rank: number
    }>(
      `SELECT c.id AS chunk_id, c.document_id, c.project_id, d.path, d.title, c.heading,
              snippet(knowledge_fts, 0, '[', ']', '…', 24) AS snippet,
              bm25(knowledge_fts) AS rank
       FROM knowledge_fts
       JOIN knowledge_chunks c ON c.rowid = knowledge_fts.rowid
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE knowledge_fts MATCH ? AND d.project_id = ? AND d.status = 'INDEXED'
       ORDER BY rank ASC LIMIT ?`,
      [match, projectId, Math.max(1, Math.min(20, Math.floor(limit)))],
    )
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      projectId: row.project_id,
      path: row.path,
      title: row.title,
      heading: row.heading,
      snippet: row.snippet,
      score: Math.max(0, -Number(row.rank ?? 0)),
      trust: 'untrusted' as const,
    }))
  }

  count(projectId: string): { documents: number; chunks: number } {
    return {
      documents: Number(this.db.get<{ n: number }>("SELECT count(*) AS n FROM knowledge_documents WHERE project_id = ? AND status = 'INDEXED'", [projectId])?.n ?? 0),
      chunks: Number(this.db.get<{ n: number }>("SELECT count(*) AS n FROM knowledge_chunks WHERE project_id = ?", [projectId])?.n ?? 0),
    }
  }
}
