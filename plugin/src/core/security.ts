/**
 * Secret detection and redaction.
 *
 * AI Factory must never persist credentials in durable memory or write them to
 * logs. This is intentionally conservative: a false positive asks the caller to
 * store a sanitized note instead of leaking a real key.
 */
import { FactoryError } from './errors.js'

interface SecretPattern {
  readonly name: string
  readonly pattern: RegExp
}

const PLACEHOLDER_RE = /^(?:<[^>]*>|\$\{[^}]*\}|redacted|example|your[_-].*|changeme|xxx+)$/i

const PATTERNS: readonly SecretPattern[] = [
  { name: 'private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'openai_style_key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'slack_token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    name: 'assigned_secret',
    pattern:
      /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{12,})["']?/i,
  },
]

/** One detected secret occurrence, without the secret value itself. */
export interface SecretFinding {
  readonly name: string
  readonly index: number
}

/** Detect secret-like material without returning the matched value. */
export function detectSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  for (const { name, pattern } of PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    for (const match of text.matchAll(re)) {
      const value = match[1]
      if (value !== undefined && PLACEHOLDER_RE.test(value)) continue
      findings.push({ name, index: match.index ?? 0 })
    }
  }
  return findings
}

/** Throw when text contains material that looks like a credential. */
export function assertNoSecrets(text: string, field = 'content'): void {
  const findings = detectSecrets(text)
  if (findings.length === 0) return
  throw new FactoryError(
    'SECRET_DETECTED',
    `Поле "${field}" похоже на секрет (${findings.map((f) => f.name).join(', ')}). ` +
      'Сохраните санитизированное описание; учётные данные должны жить в кредитном хранилище DSH, а не в памяти.',
    { field, kinds: findings.map((f) => f.name) },
  )
}

/** Redact secret-like material before writing logs or audit records. */
export function redactSecrets(text: string): string {
  let result = text
  for (const { pattern } of PATTERNS) {
    const re = new RegExp(pattern.source, `${pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`}`)
    result = result.replace(re, (match, capture?: string) => {
      if (capture !== undefined && PLACEHOLDER_RE.test(capture)) return match
      return '[REDACTED]'
    })
  }
  return result
}

/**
 * Heuristic prompt-injection markers in imported or web content.
 *
 * A marker is not proof of an attack and never changes authorization by itself.
 * It is recorded as a trust warning so a prompt can label the data as untrusted.
 */
const INJECTION_MARKERS: readonly RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|system)\s+(?:instructions?|prompts?)/i,
  /you\s+are\s+now\s+(?:an?\s+)?(?:unrestricted|different|new)\b/i,
  /system\s+prompt\s*:/i,
  /<\/?(?:system|assistant|developer)>/i,
]

/** Return matching injection markers, capped and without surrounding content. */
export function injectionMarkers(text: string): string[] {
  const found: string[] = []
  for (const marker of INJECTION_MARKERS) {
    if (marker.test(text) && found.length < 5) found.push(marker.source)
  }
  return found
}
