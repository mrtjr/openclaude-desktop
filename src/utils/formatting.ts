// ─── Utility Functions ───────��──────────────────────────────────────
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
  const smallSizes = /\b(7b|8b|9b|14b|3b|1b|0\.5b)\b/i
  if (smallSizes.test(lower)) return true
  if (lower.includes('phi') || lower.includes('mistral') && !lower.includes('large')) return true
  if (!/\d+b\b/i.test(lower)) return true
  return false
}

export function getRelativeTime(d: Date): string {
  const diff = Math.floor((new Date().getTime() - new Date(d).getTime()) / 60000)
  if (diff < 1) return 'agora'
  if (diff < 60) return `há ${diff} min`
  if (diff < 1440) return `há ${Math.floor(diff / 60)} h`
  return 'ontem'
}
