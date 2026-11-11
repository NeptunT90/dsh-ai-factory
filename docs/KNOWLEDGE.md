# Knowledge Base (RAG)

Knowledge Base indexes project-local documents under:

```text
<project.rootPath>/knowledge/
```

The current release is **lexical RAG**: SQLite FTS5/BM25. Embeddings and
`sqlite-vec` are intentionally deferred; the schema reserves embedding columns
for a future migration-free upgrade.

## Supported formats

- `.md`, `.markdown`, `.txt`
- `.html`, `.htm`
- `.json`
- `.csv`
- `.pdf` (text layer via `pdfjs-dist`)
- `.docx` (via `mammoth`)

Scanned/image-only PDFs are **not OCR'd**; they fail with a clear error.
Encrypted PDFs are rejected before parsing.

## Tools

| Tool | Risk | Access | Behavior |
|---|---|---|---|
| `factory_knowledge_add` | R1 | root-only | index a file/directory; incremental by sha256 |
| `factory_knowledge_search` | R0 | DIRECTOR, RESEARCHER, DEVELOPER, REVIEWER | FTS5/BM25, topK |
| `factory_knowledge_list` | R0 | same profiles | documents, status and chunk counts |
| `factory_knowledge_delete` | R1 | root-only | soft-delete document and remove chunks/FTS |

No automatic indexing. `factory_knowledge_add` is the only index trigger.

## Indexing

- path must be inside `<project>/knowledge`; traversal and symlinks are
  rejected;
- max file size: 10 MiB; max files: 200; max chunks/document: 500;
- unchanged documents are skipped by `sha256`;
- changed documents replace their chunks transactionally;
- parse failures mark the document `FAILED` and do not abort the batch;
- secret-like material is rejected before it enters the index;
- chunks are 1000 chars target / 1200 max / 150 overlap, with Markdown heading
  context.

## Search

Search uses FTS5 BM25 and returns:

```json
{
  "chunkId": "kch_...",
  "documentId": "kdoc_...",
  "path": "knowledge/guide.md",
  "heading": "Guide",
  "snippet": "...",
  "score": 1.2,
  "trust": "untrusted"
}
```

Every result is **untrusted data**. It is never inserted into the system prompt
and must not be executed as instructions. DIRECTOR is instructed to call search
before answering project/documentation questions and to cite the source path.

## Schema v9

```text
knowledge_documents
knowledge_chunks
knowledge_fts        (FTS5 external content)
```

`knowledge_chunks` also has reserved `embedding BLOB`, `embedding_model` and
`embedding_dim` columns; vector search is not enabled in this release.

## Isolation

Every document/chunk row carries `project_id`; search/list filter by the current
project. A document indexed in project A is invisible in project B.

## Configuration

There is no `knowledgeAutoIndex`; indexing is explicit. Future embedding
configuration will be opt-in and must not download a model implicitly.

## Security notes

- PDF/DOCX are parsed as data, never executed.
- Parser timeouts and size limits are enforced.
- `trust: untrusted` is part of the result contract.
- Delete is soft at the document level and removes searchable chunks.
- No network calls during indexing or search.
