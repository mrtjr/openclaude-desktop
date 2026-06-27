// ─── Utility Functions ──────────────────────────────────────────────
// Extracted from App.tsx

import { marked } from 'marked'
// Slim build: ~37 common languages (~120KB) instead of the full ~190-language
// bundle (~900KB). Languages outside the common set fall back to plaintext via
// the getLanguage() guard below — a worthwhile trade for a ~800KB lighter boot.
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import { ensureKatex, isKatexReady, hasMath, onKatexReady } from './katexLoader'

// Configure marked
marked.setOptions({ breaks: true, gfm: true })
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }: any) => {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(text, { language }).value
  return `<div class="code-block"><div class="code-header"><span class="code-lang">${language}</span><button class="copy-btn" data-copy>Copiar</button></div><pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`
}
marked.use({ renderer })

// ─── Sanitização HTML central (v2.116.0) ───────────────────────────
// A varredura apontou 12 usos de dangerouslySetInnerHTML que chamavam
// DOMPurify.sanitize com config DEFAULT, espalhada — se a config enfraquecesse,
// todos viravam vetor de XSS. Aqui fica UMA config explícita e endurecida +
// hook de link seguro, usada por formatMarkdown e pelos demais sites.
//
// Mantém o allowlist amplo padrão do DOMPurify (precisamos de input[checkbox]
// das task-lists, span+style inline do KaTeX output:'html', code/pre/tabelas),
// mas PROÍBE tags que são vetor e nunca aparecem na nossa saída de markdown:
// <style> (exfil via CSS), svg/math/foreignObject (XSS), iframe/object/embed/form.
const SANITIZE_CONFIG = {
  FORBID_TAGS: ['style', 'svg', 'math', 'foreignObject', 'iframe', 'object', 'embed', 'form'],
}

// Hook global (uma vez): todo link abre em nova aba com rel seguro (anti
// tabnabbing); javascript:/data: em href já são removidos pelo DOMPurify.
let _hookAdded = false
function ensureSanitizeHook(): void {
  if (_hookAdded) return
  _hookAdded = true
  DOMPurify.addHook('afterSanitizeAttributes', (node: any) => {
    if (node && node.tagName === 'A' && node.getAttribute && node.getAttribute('href')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

/** Sanitiza HTML com a config endurecida central. Use SEMPRE isto em vez de
 *  DOMPurify.sanitize direto. */
export function sanitizeHtml(html: string): string {
  ensureSanitizeHook()
  return DOMPurify.sanitize(String(html ?? ''), SANITIZE_CONFIG) as string
}

// Cache rendered HTML by source text. formatMarkdown is pure given the KaTeX
// ready-state, but the chat re-runs it for EVERY message on every streamed
// token (App re-renders per token), so a long conversation re-parses all of
// its markdown on each token — visible jank. Caching makes the stable
// messages O(1); only the growing streaming text actually re-renders. Cleared
// when KaTeX finishes loading, since math output changes from raw to typeset.
const FORMAT_CACHE = new Map<string, string>()
const FORMAT_CACHE_CAP = 600
onKatexReady(() => FORMAT_CACHE.clear())

/** Render markdown → sanitized HTML. Pass `cache=false` for transient content
 *  (the live streaming text) so it doesn't evict stable message entries. */
export function formatMarkdown(text: string, cache = true): string {
  if (!text) return ''
  if (cache) {
    const hit = FORMAT_CACHE.get(text)
    if (hit !== undefined) return hit
  }
  // Lazy-load KaTeX the first time math appears. This render stays plain and
  // upgrades to typeset output once the lib is ready (see useMathReady).
  if (!isKatexReady() && hasMath(text)) ensureKatex()
  const html = sanitizeHtml(marked.parse(text) as string)
  if (cache) {
    if (FORMAT_CACHE.size >= FORMAT_CACHE_CAP) FORMAT_CACHE.clear()
    FORMAT_CACHE.set(text, html)
  }
  return html
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

/** Extract a model's parameter count in billions from its name
 *  (e.g. "llama3.1-8b" → 8, "qwen2.5-0.5b" → 0.5, "llama-70b" → 70).
 *  Returns null when the name carries no size token. */
export function parseModelSizeB(name: string): number | null {
  const m = (name || '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*b\b/)
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}

export function isSmallModel(modelName: string): boolean {
  if (!modelName) return false
  const lower = modelName.toLowerCase()

  // Cloud / hosted / namespaced models (anything with a "/", e.g. OpenRouter or
  // Modal ids like "zai-org/GLM-5.1-FP8") are never "small" — they don't need
  // the extra agent directive.
  if (lower.startsWith('gpt-') || lower.startsWith('claude-') || lower.startsWith('gemini-') ||
      lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4') ||
      lower.includes('deepseek') || lower.includes('/')) return false

  // Families that are small regardless of an explicit size token.
  if (lower.includes('phi')) return true
  if (lower.includes('mistral') && !lower.includes('large') && !lower.includes('medium')) return true

  // Otherwise classify by parameter count: ≤14B needs the extra directive. This
  // covers 2b/4b/5b/10b–13b that the old fixed list (0.5/1/3/7/8/9/14b) missed,
  // while a 30b/70b local model stays medium/large. No size token → not small.
  const size = parseModelSizeB(lower)
  return size !== null && size <= 14
}

export function getRelativeTime(d: Date, lang: 'pt' | 'en' = 'pt'): string {
  const en = lang === 'en'
  const diff = Math.floor((new Date().getTime() - new Date(d).getTime()) / 60000)
  if (diff < 1) return en ? 'now' : 'agora'
  if (diff < 60) return en ? `${diff} min ago` : `há ${diff} min`
  if (diff < 1440) { const h = Math.floor(diff / 60); return en ? `${h} h ago` : `há ${h} h` }
  if (diff < 2880) return en ? 'yesterday' : 'ontem'
  const days = Math.floor(diff / 1440)
  if (diff < 10080) return en ? `${days} day${days > 1 ? 's' : ''} ago` : `há ${days} dia${days > 1 ? 's' : ''}`
  const weeks = Math.floor(diff / 10080)
  if (diff < 43200) return en ? `${weeks} wk ago` : `há ${weeks} sem.`
  const months = Math.floor(diff / 43200)
  return en ? `${months} mo ago` : `há ${months} ${months === 1 ? 'mês' : 'meses'}`
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
