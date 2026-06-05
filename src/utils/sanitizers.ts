// ─── Reasoning Leak Sanitizer ───────────────────────────────────────
// Some models (DeepSeek, Qwen, etc.) leak internal reasoning/thinking
// prefixes in their output. This sanitizer strips them before display.
//
// SINGLE SOURCE OF TRUTH: every reasoning-tag pair is declared once in
// REASONING_TAGS below. Both the one-shot regex pass (sanitizeReasoningLeaks)
// and the incremental StreamingSanitizer derive from this list, so the two
// paths can no longer drift apart. That drift — bracket-style [thinking]
// stripped by the one-shot pass but NOT by the streaming pass — was the
// structural cause behind the "reasoning flashes then vanishes at end of
// stream" symptom: bracket models leaked live, then the block disappeared
// once the final pass ran on the saved message.

export interface ReasoningTag {
  start: string
  end: string
}

/** The one place a reasoning-tag format is declared. Add new formats here
 *  and BOTH the one-shot and streaming sanitizers pick them up. */
export const REASONING_TAGS: ReasoningTag[] = [
  { start: '<think>', end: '</think>' },
  { start: '<thinking>', end: '</thinking>' },
  { start: '<reasoning>', end: '</reasoning>' },
  { start: '<inner_monologue>', end: '</inner_monologue>' },
  { start: '[thinking]', end: '[/thinking]' },
  { start: '[reasoning]', end: '[/reasoning]' },
  // DeepSeek-specific markers (unusual full-width bars)
  { start: '<｜begin▁of▁thought｜>', end: '<｜end▁of▁thought｜>' },
]

/** Escape a literal string so it can be embedded in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Derived from REASONING_TAGS — one lazy block matcher per tag pair.
const REASONING_PATTERNS: RegExp[] = REASONING_TAGS.map(
  ({ start, end }) => new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'gi'),
)

// Capturing variant — same blocks, but exposes the inner reasoning text so
// extractThinking can KEEP it (for an Extended-Thinking display) instead of
// discarding it like the sanitizer does.
const REASONING_CAPTURE: RegExp[] = REASONING_TAGS.map(
  ({ start, end }) => new RegExp(`${escapeRegExp(start)}([\\s\\S]*?)${escapeRegExp(end)}`, 'gi'),
)

/**
 * Strip leaked reasoning/thinking blocks from model output.
 * Returns cleaned text. Safe to call on any string.
 */
export function sanitizeReasoningLeaks(text: string): string {
  let cleaned = text
  for (const pattern of REASONING_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }
  // Remove leading whitespace left by removed blocks
  return cleaned.replace(/^\s+/, '')
}

/**
 * Sanitize, but never collapse a non-empty reply into nothing.
 *
 * If stripping reasoning would wipe the whole message — the model wrapped
 * its entire answer in <think>…, or a stream ended mid-tag — we return the
 * raw text instead. A reply with visible reasoning beats a blank bubble.
 * This is the v2.12.7 "never blank" invariant, centralised here so the
 * streaming path, the non-streaming path, and any future caller all share
 * one implementation instead of re-deriving the same ternary inline.
 *
 * Returns '' only when `raw` was itself empty/whitespace.
 */
export function sanitizeReasoningLeaksSafe(raw: string): string {
  const sanitized = sanitizeReasoningLeaks(raw)
  if (sanitized.trim().length > 0) return sanitized
  if (raw.trim().length > 0) return raw
  return sanitized
}

/**
 * Split model output into its reasoning ("thinking") and the visible answer —
 * the capturing counterpart to sanitizeReasoningLeaks. Only COMPLETE blocks
 * are captured (using the same REASONING_TAGS registry); partial/malformed
 * leaks are left for the sanitizer. Lets the UI show an Extended-Thinking-style
 * collapsible block instead of throwing the reasoning away.
 */
export function extractThinking(raw: string): { thinking: string; answer: string } {
  if (!raw) return { thinking: '', answer: '' }
  const parts: string[] = []
  let answer = raw
  for (const pattern of REASONING_CAPTURE) {
    answer = answer.replace(pattern, (_full, inner) => {
      const t = String(inner).trim()
      if (t) parts.push(t)
      return ''
    })
  }
  return { thinking: parts.join('\n\n').trim(), answer: answer.replace(/^\s+/, '') }
}

/**
 * Localised notice shown when the model genuinely returned nothing
 * (max_tokens=0, network truncation, provider glitch) — used in place of a
 * silent blank bubble. Centralised so the streaming and non-streaming paths
 * can't drift in wording.
 */
export function emptyReplyNotice(lang: string): string {
  return lang === 'en'
    ? '_(empty response from model — try again, lower max_tokens, or switch model)_'
    : '_(resposta vazia do modelo — tente novamente, reduza max_tokens ou troque o modelo)_'
}

/**
 * Sanitize streaming chunks incrementally.
 * Buffers potential reasoning tags until we know if they're complete.
 * Tag formats come from the shared REASONING_TAGS registry, so streaming
 * strips exactly what the one-shot pass strips.
 */
export class StreamingSanitizer {
  private buffer = ''
  private inTag = false
  private endTag = ''

  /** Process a chunk of streaming text. Returns the safe-to-display portion.
   *  Fully drains the buffer each call, handling as many open/close tag
   *  transitions as appear — so a closed block followed by more text (or
   *  even a second block) in the same buffer is stripped live instead of
   *  leaking out via flush() and only getting cleaned on the saved copy. */
  process(chunk: string): string {
    this.buffer += chunk
    let output = ''

    for (;;) {
      if (this.inTag) {
        const endIdx = this.buffer.toLowerCase().indexOf(this.endTag.toLowerCase())
        if (endIdx === -1) {
          // Still inside the reasoning block — hold the buffer, emit nothing more.
          return output
        }
        // Found the closing tag — drop the block and keep scanning the rest.
        this.buffer = this.buffer.substring(endIdx + this.endTag.length)
        this.inTag = false
        this.endTag = ''
        continue
      }

      // Find the EARLIEST-positioned complete start tag, so when two
      // different tags are both present we open the one that comes first
      // rather than whichever happens to be earlier in the registry.
      const lower = this.buffer.toLowerCase()
      let startIdx = -1
      let startTag: ReasoningTag | null = null
      for (const tag of REASONING_TAGS) {
        const idx = lower.indexOf(tag.start.toLowerCase())
        if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
          startIdx = idx
          startTag = tag
        }
      }
      if (startTag) {
        output += this.buffer.substring(0, startIdx)
        this.buffer = this.buffer.substring(startIdx)
        this.inTag = true
        this.endTag = startTag.end
        continue
      }

      // No complete start tag. Hold back a trailing partial that could be
      // the start of one (longest match across all tags) so we never emit
      // half a tag that completes on the next chunk; emit the rest.
      let holdback = 0
      for (const tag of REASONING_TAGS) {
        const start = tag.start.toLowerCase()
        const maxLen = Math.min(start.length - 1, this.buffer.length)
        for (let i = maxLen; i > holdback; i--) {
          if (lower.endsWith(start.substring(0, i))) {
            holdback = i
            break
          }
        }
      }
      if (holdback > 0) {
        output += this.buffer.substring(0, this.buffer.length - holdback)
        this.buffer = this.buffer.substring(this.buffer.length - holdback)
      } else {
        output += this.buffer
        this.buffer = ''
      }
      return output
    }
  }

  /** Flush buffer — call when stream ends.
   *  If we ended mid-reasoning-tag (model cut off before its closing tag),
   *  emit the buffered content anyway: silently eating it was the root
   *  cause of the v2.12.x "chat interrupted after plan_tasks" symptom —
   *  when a streaming reply was entirely enclosed in an unclosed <think>,
   *  the user saw a blank message. Leaking some reasoning text is strictly
   *  better than an empty response. The one-shot regex pass in
   *  `sanitizeReasoningLeaks` still removes properly-closed blocks from the
   *  saved message post-flush, so this only changes behaviour for the
   *  degenerate "never-closed" case. */
  flush(): string {
    const out = this.buffer
    this.buffer = ''
    this.inTag = false
    this.endTag = ''
    return out
  }
}
