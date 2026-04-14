// ─── Utility Functions ──────────────────────────────────────────────
// Extracted from App.tsx

import { marked } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'

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
  const html = marked.parse(text) as string
  return DOMPurify.sanitize(html)
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
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
