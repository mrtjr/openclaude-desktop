// ─── Utility Functions ──────────────────────────────────────────────
// Extracted from App.tsx

import { marked } from 'marked'
// Slim build: ~37 common languages (~120KB) instead of the full ~190-language
// bundle (~900KB). Languages outside the common set fall back to plaintext via
// the getLanguage() guard below — a worthwhile trade for a ~800KB lighter boot.
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import { ensureKatex, isKatexReady, hasMath } from './katexLoader'

// Configure marked
marked.setOptions({ breaks: true, gfm: true })
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }: any) => {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(text, { language }).value
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${language}</span><button class="copy-btn" data-copy>Copiar</button></div><pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`
}
marked.use({ renderer })

export function formatMarkdown(text: string): string {
  // Lazy-load KaTeX the first time math appears. This render stays plain and
  // upgrades to typeset output once the lib is ready (see useMathReady).
  if (!isKatexReady() && hasMath(text)) ensureKatex()
  const html = marked.parse(text) as string
  return DOMPurify.sanitize(html)
}

export function generateId(): string {
  // Prefer crypto.randomUUID when available — 122 bits of entropy, no collision
  // concern even across millions of ids. Fall back to a longer Math.random +
  // timestamp combo for exotic runtimes (old jsdom, etc.). The previous
  // 7-char base36 id had only ~36 bits, which hit birthday collisions around
  // ~9k ids — realistic for long-running conversation histories.
  const g = (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : null
  if (g) return g
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function isSmallModel(modelName: string): boolean {
  if (!modelName) return false
  const lower = modelName.toLowerCase()

  // Cloud models are never "small" — they don't need the extra agent directive
  if (lower.startsWith('gpt-') || lower.startsWith('claude-') || lower.startsWith('gemini-') ||
      lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4') ||
      lower.includes('deepseek') || lower.includes('/')) return false

  const smallSizes = /\b(0\.5b|1b|3b|7b|8b|9b|14b)\b/i
  if (smallSizes.test(lower)) return true

  // Models explicitly known as small
  if (lower.includes('phi')) return true
  if (lower.includes('mistral') && !lower.includes('large') && !lower.includes('medium')) return true

  // If no size indicator found in local model name, assume medium/large
  const hasSize = /\d+b\b/i.test(lower)
  if (!hasSize) return false

  return false
}

export function getRelativeTime(d: Date): string {
  const diff = Math.floor((new Date().getTime() - new Date(d).getTime()) / 60000)
  if (diff < 1) return 'agora'
  if (diff < 60) return `há ${diff} min`
  if (diff < 1440) return `há ${Math.floor(diff / 60)} h`
  if (diff < 2880) return 'ontem'
  const days = Math.floor(diff / 1440)
  if (diff < 10080) return `há ${days} dia${days > 1 ? 's' : ''}`
  const weeks = Math.floor(diff / 10080)
  if (diff < 43200) return `há ${weeks} sem.`
  const months = Math.floor(diff / 43200)
  return `há ${months} ${months === 1 ? 'mês' : 'meses'}`
}

/** Sidebar bucket labels for ChatGPT/Claude-style temporal grouping. */
export type TimeBucket = 'today' | 'yesterday' | 'week' | 'month' | 'older'

const BUCKET_LABEL_PT: Record<TimeBucket, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  week: 'Últimos 7 dias',
  month: 'Últimos 30 dias',
  older: 'Anterior',
}

const BUCKET_LABEL_EN: Record<TimeBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Previous 7 days',
  month: 'Previous 30 days',
  older: 'Older',
}

export function bucketLabel(b: TimeBucket, lang: 'pt' | 'en' = 'pt'): string {
  return (lang === 'en' ? BUCKET_LABEL_EN : BUCKET_LABEL_PT)[b]
}

/** Classify a timestamp into one of five temporal buckets.
 *  Based on the *start* of today, not a rolling 24h — "ontem" means
 *  the calendar day before today, matching user intuition. */
export function timeBucket(d: Date | string | number): TimeBucket {
  const t = new Date(d).getTime()
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const DAY = 86_400_000
  if (t >= startOfToday) return 'today'
  if (t >= startOfToday - DAY) return 'yesterday'
  if (t >= startOfToday - 7 * DAY) return 'week'
  if (t >= startOfToday - 30 * DAY) return 'month'
  return 'older'
}

/** Preserve chronological order of buckets. */
export const BUCKET_ORDER: TimeBucket[] = ['today', 'yesterday', 'week', 'month', 'older']

/** Group a pre-sorted conversation list by temporal bucket.
 *  Returns an ordered array of [bucket, items[]] — empty buckets omitted. */
export function groupByBucket<T extends { createdAt: Date | string | number }>(
  items: T[],
): Array<[TimeBucket, T[]]> {
  const groups = new Map<TimeBucket, T[]>()
  for (const item of items) {
    const b = timeBucket(item.createdAt)
    const arr = groups.get(b)
    if (arr) arr.push(item)
    else groups.set(b, [item])
  }
  return BUCKET_ORDER
    .filter(b => groups.has(b))
    .map(b => [b, groups.get(b)!] as [TimeBucket, T[]])
}
