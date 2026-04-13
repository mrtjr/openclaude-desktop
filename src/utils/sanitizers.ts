// ─── Reasoning Leak Sanitizer ───────────────────────────────────────
// Some models (DeepSeek, Qwen, etc.) leak internal reasoning/thinking
// prefixes in their output. This sanitizer strips them before display.

const REASONING_PATTERNS: RegExp[] = [
  // XML-style thinking blocks
  /<think>[\s\S]*?<\/think>/gi,
  /<thinking>[\s\S]*?<\/thinking>/gi,
  /<reasoning>[\s\S]*?<\/reasoning>/gi,
  /<inner_monologue>[\s\S]*?<\/inner_monologue>/gi,
  // Bracket-style thinking blocks
  /\[thinking\][\s\S]*?\[\/thinking\]/gi,
  /\[reasoning\][\s\S]*?\[\/reasoning\]/gi,
  // DeepSeek-specific reasoning prefix (often appears at start)
  /^<｜begin▁of▁thought｜>[\s\S]*?<｜end▁of▁thought｜>/gm,
]

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
 * Sanitize streaming chunks incrementally.
 * Buffers potential reasoning tags until we know if they're complete.
 */
export class StreamingSanitizer {
  private buffer = ''
  private inTag = false
  private tagName = ''

  private static TAG_STARTS = ['<think>', '<thinking>', '<reasoning>', '<inner_monologue>', '<｜begin▁of▁thought｜>']
  private static TAG_ENDS: Record<string, string> = {
    '<think>': '</think>',
    '<thinking>': '</thinking>',
    '<reasoning>': '</reasoning>',
    '<inner_monologue>': '</inner_monologue>',
    '<｜begin▁of▁thought｜>': '<｜end▁of▁thought｜>',
  }

  /** Process a chunk of streaming text. Returns the safe-to-display portion. */
  process(chunk: string): string {
    this.buffer += chunk

    if (this.inTag) {
      const endTag = StreamingSanitizer.TAG_ENDS[this.tagName]
      const endIdx = this.buffer.toLowerCase().indexOf(endTag.toLowerCase())
      if (endIdx !== -1) {
        // Found end tag — discard everything up to and including it
        this.buffer = this.buffer.substring(endIdx + endTag.length)
        this.inTag = false
        this.tagName = ''
        return this.flush()
      }
      // Still inside reasoning block — buffer everything
      return ''
    }

    // Check for start of reasoning tag
    for (const tag of StreamingSanitizer.TAG_STARTS) {
      const tagIdx = this.buffer.toLowerCase().indexOf(tag.toLowerCase())
      if (tagIdx !== -1) {
        // Found start tag — emit text before it, then enter tag mode
        const before = this.buffer.substring(0, tagIdx)
        this.buffer = this.buffer.substring(tagIdx)
        this.inTag = true
        this.tagName = tag
        return before
      }
      // Check for partial tag at end of buffer (might be incomplete)
      for (let i = 1; i < tag.length; i++) {
        if (this.buffer.endsWith(tag.substring(0, i))) {
          // Potential partial tag — hold back those characters
          const safe = this.buffer.substring(0, this.buffer.length - i)
          this.buffer = this.buffer.substring(this.buffer.length - i)
          return safe
        }
      }
    }

    return this.flush()
  }

  /** Flush buffer — call when stream ends */
  flush(): string {
    const out = this.buffer
    this.buffer = ''
    return out
  }
}
