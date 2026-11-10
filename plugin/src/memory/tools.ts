import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FactoryError } from '../core/errors.js'
import type { FactoryRuntime } from '../runtime.js'
import {
  MEMORY_KINDS,
  MEMORY_SCOPES,
  MEMORY_SOURCE_TYPES,
  MEMORY_TRUST_LEVELS,
  type MemoryKind,
  type MemoryRecord,
} from '../memory/types.js'

const ENTRY_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    scope: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    title: { type: 'string', required: true },
    content: { type: 'string', required: true },
    tags: { type: 'array', items: { type: 'string' }, required: true },
    trust: { type: 'string', required: true },
    confidence: { type: 'number', required: true },
    sourceType: { type: 'string', required: true },
    status: { type: 'string', required: true },
    version: { type: 'number', required: true },
    createdAt: { type: 'number', required: true },
    updatedAt: { type: 'number', required: true },
    expiresAt: { type: 'number', required: true },
  },
} as const

const SEARCH_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    count: { type: 'number', required: true },
    results: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          projectId: { type: 'string', required: true },
          scope: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          title: { type: 'string', required: true },
          snippet: { type: 'string', required: true },
          score: { type: 'number', required: true },
          trust: { type: 'string', required: true },
          confidence: { type: 'number', required: true },
          tags: { type: 'array', items: { type: 'string' }, required: true },
          updatedAt: { type: 'number', required: true },
        },
      },
    },
  },
} as const

interface EntryView {
  id: string
  projectId: string
  scope: string
  kind: string
  title: string
  content: string
  tags: string[]
  trust: string
  confidence: number
  sourceType: string
  status: string
  version: number
  createdAt: number
  updatedAt: number
  expiresAt: number
}

interface SearchHitView {
  id: string
  projectId: string
  scope: string
  kind: string
  title: string
  snippet: string
  score: number
  trust: string
  confidence: number
  tags: string[]
  updatedAt: number
}

function view(entry: MemoryRecord): EntryView {
  return {
    id: entry.id,
    projectId: entry.projectId ?? '',
    scope: entry.scope,
    kind: entry.kind,
    title: entry.title,
    content: entry.content,
    tags: [...entry.tags],
    trust: entry.trust,
    confidence: entry.confidence,
    sourceType: entry.sourceType,
    status: entry.status,
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt ?? 0,
  }
}

function formatEntry(entry: EntryView): string {
  return [
    `# ${entry.title}`,
    `id: ${entry.id}`,
    `тип: ${entry.kind} · область: ${entry.scope} · доверие: ${entry.trust} · v${entry.version}`,
    entry.projectId ? `проект: ${entry.projectId}` : 'проект: глобальная память',
    entry.tags.length > 0 ? `теги: ${entry.tags.join(', ')}` : '',
    '',
    entry.content,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function formatHit(hit: SearchHitView): string {
  return `[${hit.kind}/${hit.trust}] ${hit.title}\n${hit.snippet}\n(${hit.id}, score ${hit.score.toFixed(2)})`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function requireRuntime(getRuntime: () => FactoryRuntime | undefined, startupError: () => string | undefined): FactoryRuntime {
  const runtime = getRuntime()
  if (!runtime) {
    throw new FactoryError(
      'STORAGE_UNAVAILABLE',
      `AI Factory не инициализирован: ${startupError() ?? 'причина неизвестна'}`,
    )
  }
  return runtime
}

/** Register all memory tools. Returns exact disposers for Cordis lifecycle. */
export function registerMemoryTools(
  ctx: Context,
  getRuntime: () => FactoryRuntime | undefined,
  getStartupError: () => string | undefined,
): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_memory_remember',
        description:
          'Сохранить durable-запись в память AI Factory. ' +
          'working — текущая задача/промежуточный результат; episodic — событие, решение, ошибка; ' +
          'semantic — проверенный факт или знание; project — архитектура/состояние проекта; user — предпочтение пользователя. ' +
          'Не сохраняйте пароли, токены и ключи: инструмент отклонит секрет. ' +
          'Повтор с тем же содержимым не создаёт дубликат и возвращает deduplicated=true.',
        parameters: {
          content: { type: 'string', required: true, description: 'Текст записи. Для фактов и решений — самодостаточный.' },
          title: { type: 'string', description: 'Короткий заголовок; по умолчанию первая строка.' },
          kind: { type: 'string', enum: MEMORY_KINDS, description: 'Тип памяти (по умолчанию semantic).' },
          scope: { type: 'string', enum: MEMORY_SCOPES, description: 'project (по умолчанию) или global.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Теги для фильтрации.' },
          trust: {
            type: 'string',
            enum: MEMORY_TRUST_LEVELS,
            description: 'Доверие к записи. По умолчанию unverified; user_confirmed только для слов пользователя.',
          },
          confidence: { type: 'number', description: 'Уверенность 0..1 (по умолчанию 0.7).' },
          sourceType: {
            type: 'string',
            enum: MEMORY_SOURCE_TYPES,
            description: 'Источник: user, agent, tool, import или system.',
          },
          sourceRef: { type: 'string', description: 'Ссылка на источник: URL, файл, id сессии.' },
          ttlHours: { type: 'number', description: 'Срок жизни в часах; 0 — без срока.' },
          supersedes: { type: 'string', description: 'id старой записи, которую заменяет новая.' },
          metadata: { type: 'json', description: 'Дополнительные JSON-метаданные (до 64 KiB).' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              deduplicated: { type: 'boolean', required: true },
              entry: { ...ENTRY_OUTPUT, required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: value.deduplicated
                ? `Запись уже существует (дубликат не создан).\n\n${formatEntry(value.entry)}`
                : formatEntry(value.entry),
            },
          ],
        },
        async execute(args, exec) {
          const runtime = requireRuntime(getRuntime, getStartupError)
          const project = runtime.projectFor(exec)
          const result = runtime.memory.remember({
            content: args.content,
            title: args.title,
            kind: args.kind as MemoryKind | undefined,
            scope: args.scope,
            projectId: project.id,
            tags: args.tags,
            trust: args.trust,
            confidence: args.confidence,
            sourceType: args.sourceType,
            sourceRef: args.sourceRef,
            agentId: exec.agent?.id,
            sessionId: exec.agent?.id,
            metadata: asRecord(args.metadata),
            ttlHours: args.ttlHours,
            supersedesId: args.supersedes,
            actor: exec.agent?.id ?? 'agent',
          })
          runtime.auditTool('memory.remember', project, exec, {
            memoryId: result.entry.id,
            kind: result.entry.kind,
            scope: result.entry.scope,
            deduplicated: result.deduplicated,
          })
          return { deduplicated: result.deduplicated, entry: view(result.entry) }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_memory_search',
        description:
          'Найти durable-записи AI Factory по ключевым словам с учётом проекта. ' +
          'По умолчанию ищет в текущем проекте и в глобальной памяти. Возвращает сниппеты, тип, доверие и id для get/update.',
        parameters: {
          query: { type: 'string', description: 'Поисковый запрос; пусто = последние записи.' },
          kinds: {
            type: 'array',
            items: { type: 'string', enum: MEMORY_KINDS },
            description: 'Ограничить типы памяти.',
          },
          scope: { type: 'string', enum: MEMORY_SCOPES, description: 'Ограничить областью.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Все указанные теги.' },
          includeGlobal: { type: 'boolean', description: 'Включать глобальную память (по умолчанию true).' },
          limit: { type: 'number', description: 'Максимум результатов (1..100).' },
        },
        output: {
          schema: SEARCH_OUTPUT,
          render: (_args, value) => [
            {
              type: 'text',
              text:
                value.count === 0
                  ? 'Ничего не найдено.'
                  : `Найдено ${value.count}:\n\n${value.results.map(formatHit).join('\n\n')}`,
            },
          ],
        },
        async execute(args, exec) {
          const runtime = requireRuntime(getRuntime, getStartupError)
          const project = runtime.projectFor(exec)
          const results = runtime.memory.search({
            query: args.query,
            projectId: project.id,
            includeGlobal: args.includeGlobal ?? true,
            kinds: args.kinds as MemoryKind[] | undefined,
            scope: args.scope,
            tags: args.tags,
            limit: args.limit,
          })
          runtime.auditTool('memory.search', project, exec, {
            queryLength: args.query?.length ?? 0,
            resultCount: results.length,
          })
          return {
            count: results.length,
            results: results.map((hit) => ({
              id: hit.id,
              projectId: hit.projectId ?? '',
              scope: hit.scope,
              kind: hit.kind,
              title: hit.title,
              snippet: hit.snippet,
              score: hit.score,
              trust: hit.trust,
              confidence: hit.confidence,
              tags: [...hit.tags],
              updatedAt: hit.updatedAt,
            })),
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_memory_get',
        description: 'Прочитать одну durable-запись AI Factory по id, включая полный текст и метаданные версии.',
        parameters: {
          id: { type: 'string', required: true, description: 'id вида mem_...' },
        },
        output: {
          schema: ENTRY_OUTPUT,
          render: (_args, value) => [{ type: 'text', text: formatEntry(value) }],
        },
        async execute(args) {
          const runtime = requireRuntime(getRuntime, getStartupError)
          const entry = runtime.memory.require(args.id)
          return view(entry)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_memory_update',
        description:
          'Исправить durable-запись с сохранением старой версии в истории. ' +
          'Поддерживает оптимистичную проверку expectedVersion. Секреты отклоняются.',
        parameters: {
          id: { type: 'string', required: true, description: 'id записи' },
          title: { type: 'string', description: 'Новый заголовок' },
          content: { type: 'string', description: 'Новый текст' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Новый набор тегов' },
          trust: { type: 'string', enum: MEMORY_TRUST_LEVELS, description: 'Новый уровень доверия' },
          confidence: { type: 'number', description: 'Новая уверенность 0..1' },
          ttlHours: { type: 'number', description: 'Новый TTL в часах; 0 снимает срок' },
          expectedVersion: { type: 'number', description: 'Ожидаемая версия для защиты от гонки' },
          reason: { type: 'string', description: 'Причина изменения для истории' },
          metadata: { type: 'json', description: 'Дополнительные метаданные (сливаются с текущими)' },
        },
        output: {
          schema: ENTRY_OUTPUT,
          render: (_args, value) => [{ type: 'text', text: formatEntry(value) }],
        },
        async execute(args, exec) {
          const runtime = requireRuntime(getRuntime, getStartupError)
          const entry = runtime.memory.update({
            id: args.id,
            title: args.title,
            content: args.content,
            tags: args.tags,
            trust: args.trust,
            confidence: args.confidence,
            ttlHours: args.ttlHours,
            expectedVersion: args.expectedVersion,
            reason: args.reason,
            metadata: args.metadata === undefined ? undefined : asRecord(args.metadata),
            actor: exec.agent?.id ?? 'agent',
          })
          runtime.auditTool('memory.update', runtime.projectFor(exec), exec, { memoryId: entry.id, version: entry.version })
          return view(entry)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_memory_forget',
        description: 'Мягко удалить durable-запись (soft delete) с сохранением истории версий. Физическое удаление не выполняется.',
        parameters: {
          id: { type: 'string', required: true, description: 'id записи' },
          reason: { type: 'string', description: 'Причина удаления' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              forgotten: { type: 'boolean', required: true },
              version: { type: 'number', required: true },
            },
          },
          render: (_args, value) => [
            { type: 'text', text: `Запись ${value.id} помечена удалённой (версия ${value.version}). История сохранена.` },
          ],
        },
        async execute(args, exec) {
          const runtime = requireRuntime(getRuntime, getStartupError)
          const entry = runtime.memory.forget(args.id, exec.agent?.id ?? 'agent', args.reason ?? 'forget')
          runtime.auditTool('memory.forget', runtime.projectFor(exec), exec, { memoryId: entry.id })
          return { id: entry.id, forgotten: true, version: entry.version }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_memory_history',
        description: 'Показать историю версий записи: кто, когда и почему изменил, и снимки прежних состояний.',
        parameters: {
          id: { type: 'string', required: true, description: 'id записи' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'number', required: true },
              versions: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    version: { type: 'number', required: true },
                    changedBy: { type: 'string', required: true },
                    changeReason: { type: 'string', required: true },
                    createdAt: { type: 'number', required: true },
                    title: { type: 'string', required: true },
                    content: { type: 'string', required: true },
                    trust: { type: 'string', required: true },
                    confidence: { type: 'number', required: true },
                  },
                },
              },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text:
                value.count === 0
                  ? 'История пуста.'
                  : `Версий: ${value.count}\n\n${value.versions
                      .map(
                        (v) =>
                          `v${v.version} · ${v.changedBy} · ${new Date(v.createdAt).toISOString()} · ${v.changeReason}\n${v.title}\n${v.content}`,
                      )
                      .join('\n\n---\n\n')}`,
            },
          ],
        },
        async execute(args) {
          const runtime = requireRuntime(getRuntime, getStartupError)
          const versions = runtime.memory.history(args.id)
          return {
            count: versions.length,
            versions: versions.map((version) => ({
              version: version.version,
              changedBy: version.changedBy,
              changeReason: version.changeReason ?? '',
              createdAt: version.createdAt,
              title: version.snapshot.title,
              content: version.snapshot.content,
              trust: version.snapshot.trust,
              confidence: version.snapshot.confidence,
            })),
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'factory_memory_stats',
        description: 'Статистика локальной памяти AI Factory: активные записи, типы, области, проекты, версии.',
        parameters: {},
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              totalEntries: { type: 'number', required: true },
              activeEntries: { type: 'number', required: true },
              byKind: { type: 'json', required: true },
              byScope: { type: 'json', required: true },
              projects: { type: 'number', required: true },
              versions: { type: 'number', required: true },
              auditEvents: { type: 'number', required: true },
              dbBytes: { type: 'number', required: true },
            },
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: [
                `память: ${value.activeEntries} активных / ${value.totalEntries} всего`,
                `по типам: ${JSON.stringify(value.byKind)}`,
                `по областям: ${JSON.stringify(value.byScope)}`,
                `проектов: ${value.projects}; версий: ${value.versions}; audit: ${value.auditEvents}`,
                `размер БД: ${value.dbBytes} байт`,
              ].join('\n'),
            },
          ],
        },
        async execute() {
          const runtime = requireRuntime(getRuntime, getStartupError)
          return runtime.memory.stats()
        },
      }),
    ),
  )

  return disposers
}
