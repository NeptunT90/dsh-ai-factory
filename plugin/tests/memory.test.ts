import { describe, expect, it } from 'vitest'
import { createTestRuntime, track } from './helpers.js'

describe('MemoryEngine', () => {
  it('stores, deduplicates, searches and versions entries', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const first = runtime.memory.remember({
      content: 'Проект использует локальный SQLite и FTS5 для поиска.',
      title: 'Хранилище проекта',
      kind: 'project',
      projectId,
      tags: ['sqlite', 'fts'],
    })
    expect(first.deduplicated).toBe(false)
    expect(first.entry.version).toBe(1)
    expect(first.entry.projectId).toBe(projectId)

    const duplicate = runtime.memory.remember({
      content: 'Проект использует локальный SQLite и FTS5 для поиска.',
      kind: 'project',
      projectId,
    })
    expect(duplicate.deduplicated).toBe(true)
    expect(duplicate.entry.id).toBe(first.entry.id)
    expect(duplicate.entry.accessCount).toBe(1)

    const hits = runtime.memory.search({ query: 'SQLite', projectId })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.id).toBe(first.entry.id)
    expect(hits[0]?.snippet.toLowerCase()).toContain('sqlite')

    const updated = runtime.memory.update({
      id: first.entry.id,
      content: 'Проект использует локальный SQLite с FTS5 для полнотекстового поиска.',
      expectedVersion: 1,
    })
    expect(updated.version).toBe(2)
    expect(runtime.memory.history(first.entry.id)).toHaveLength(1)
    expect(runtime.memory.search({ query: 'полнотекстового', projectId })[0]?.id).toBe(first.entry.id)
  })

  it('rejects stale versions', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const entry = runtime.memory.remember({ content: 'version guard', kind: 'semantic', projectId }).entry
    runtime.memory.update({ id: entry.id, content: 'version guard updated' })
    expect(() => runtime.memory.update({ id: entry.id, content: 'stale', expectedVersion: 1 })).toThrowError(
      /Ожидалась версия 1/,
    )
  })

  it('soft-deletes and keeps history', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const entry = runtime.memory.remember({ content: 'удаляемая запись', kind: 'episodic', projectId }).entry
    const forgotten = runtime.memory.forget(entry.id)
    expect(forgotten.status).toBe('deleted')
    expect(forgotten.version).toBe(2)
    expect(runtime.memory.search({ query: 'удаляемая', projectId })).toHaveLength(0)
    expect(runtime.memory.history(entry.id).length).toBe(1)
  })

  it('supports global user memory without a project', () => {
    const { runtime } = track(createTestRuntime())
    const entry = runtime.memory.remember({
      content: 'Пользователь предпочитает краткие отчёты на русском.',
      kind: 'user',
      sourceType: 'user',
      tags: ['preferences'],
    })
    expect(entry.entry.scope).toBe('global')
    expect(entry.entry.projectId).toBeNull()
    expect(entry.entry.trust).toBe('user_confirmed')
  })

  it('rejects credentials before they reach the store', () => {
    const fakeApiKey = 'sk-' + 'a'.repeat(36)
    const { runtime, projectId } = track(createTestRuntime())
    expect(() =>
      runtime.memory.remember({
        content: `ключ: ${fakeApiKey}`,
        kind: 'semantic',
        projectId,
      }),
    ).toThrowError(/секрет/)
    expect(runtime.memory.stats().totalEntries).toBe(0)
  })

  it('expires working memory with a TTL', () => {
    const { runtime, projectId } = track(createTestRuntime())
    const entry = runtime.memory.remember({
      content: 'временная рабочая заметка',
      kind: 'working',
      projectId,
      ttlHours: 1,
    }).entry
    const count = runtime.memory.expire(entry.expiresAt ?? 0)
    expect(count).toBe(1)
    expect(runtime.memory.require(entry.id).status).toBe('deleted')
  })
})
