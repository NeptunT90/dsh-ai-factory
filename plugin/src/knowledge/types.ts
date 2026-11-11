export const KNOWLEDGE_EXTENSIONS = ['.md', '.markdown', '.txt', '.html', '.htm', '.json', '.csv', '.pdf', '.docx'] as const
export type KnowledgeExtension = (typeof KNOWLEDGE_EXTENSIONS)[number]

export const KNOWLEDGE_STATUSES = ['PENDING', 'INDEXED', 'FAILED', 'DELETED'] as const
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number]

export interface ExtractedText {
  readonly text: string
  readonly title: string
  readonly mime: string
  readonly pages?: number
  readonly warnings: readonly string[]
}

export interface KnowledgeDocument {
  readonly id: string
  readonly projectId: string
  readonly path: string
  readonly title: string
  readonly mime: string | null
  readonly size: number
  readonly sha256: string
  readonly status: KnowledgeStatus
  readonly error: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly createdAt: number
  readonly updatedAt: number
  readonly indexedAt: number | null
  readonly chunks: number
}

export interface KnowledgeChunkInput {
  readonly ordinal: number
  readonly heading: string
  readonly text: string
  readonly charStart: number
  readonly charEnd: number
  readonly tokenEstimate: number
  readonly contentHash: string
}

export interface KnowledgeSearchHit {
  readonly chunkId: string
  readonly documentId: string
  readonly projectId: string
  readonly path: string
  readonly title: string
  readonly heading: string
  readonly snippet: string
  readonly score: number
  readonly trust: 'untrusted'
}

export interface KnowledgeAddResult {
  readonly documents: number
  readonly indexed: number
  readonly skipped: number
  readonly failed: number
  readonly errors: ReadonlyArray<{ path: string; code: string; message: string }>
}
