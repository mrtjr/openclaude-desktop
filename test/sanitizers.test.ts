import { describe, it, expect } from 'vitest'
import {
  sanitizeReasoningLeaks,
  sanitizeReasoningLeaksSafe,
  extractThinking,
  emptyReplyNotice,
  StreamingSanitizer,
  REASONING_TAGS,
} from '../src/utils/sanitizers'

describe('extractThinking', () => {
  it('separates a complete <think> block from the answer', () => {
    const { thinking, answer } = extractThinking('<think>step 1\nstep 2</think>The answer is 42.')
    expect(thinking).toBe('step 1\nstep 2')
    expect(answer).toBe('The answer is 42.')
  })

  it('handles multiple blocks and other tag styles', () => {
    const { thinking, answer } = extractThinking('[thinking]a[/thinking]Hi <reasoning>b</reasoning>there')
    expect(thinking).toContain('a')
    expect(thinking).toContain('b')
    expect(answer).toBe('Hi there')
  })

  it('returns empty thinking when there is none', () => {
    expect(extractThinking('just an answer')).toEqual({ thinking: '', answer: 'just an answer' })
  })

  it('the cleaned answer matches sanitizeReasoningLeaks', () => {
    const raw = '<think>x</think>  hello'
    expect(extractThinking(raw).answer).toBe(sanitizeReasoningLeaks(raw))
  })
})

describe('sanitizeReasoningLeaks', () => {
  it('strips <think> blocks', () => {
    const input = '<think>debating answer</think>Olá mundo'
    expect(sanitizeReasoningLeaks(input)).toBe('Olá mundo')
  })

  it('strips <reasoning> blocks', () => {
    const input = '<reasoning>step 1\nstep 2</reasoning>Resposta final'
    expect(sanitizeReasoningLeaks(input)).toBe('Resposta final')
  })

  it('strips [thinking] bracket blocks', () => {
    const input = '[thinking]I should say hi[/thinking]Oi!'
    expect(sanitizeReasoningLeaks(input)).toBe('Oi!')
  })

  it('strips multiple consecutive blocks', () => {
    const input = '<think>a</think><thinking>b</thinking>final'
    expect(sanitizeReasoningLeaks(input)).toBe('final')
  })

  it('is safe on clean text (no changes)', () => {
    expect(sanitizeReasoningLeaks('Hello world')).toBe('Hello world')
  })

  it('handles DeepSeek begin/end of thought markers', () => {
    const input = '<｜begin▁of▁thought｜>hmm<｜end▁of▁thought｜>Ready'
    expect(sanitizeReasoningLeaks(input)).toBe('Ready')
  })

  it('strips case-insensitively', () => {
    const input = '<THINK>uppercase</THINK>hi'
    expect(sanitizeReasoningLeaks(input)).toBe('hi')
  })

  it('returns empty string when input is pure reasoning', () => {
    expect(sanitizeReasoningLeaks('<think>only thinking</think>')).toBe('')
  })
})

describe('StreamingSanitizer', () => {
  it('passes through clean text chunks', () => {
    const s = new StreamingSanitizer()
    expect(s.process('Hello ')).toBe('Hello ')
    expect(s.process('world')).toBe('world')
  })

  it('buffers and discards reasoning block across chunks', () => {
    const s = new StreamingSanitizer()
    expect(s.process('before <think>')).toBe('before ')
    expect(s.process('hidden reasoning ')).toBe('')
    expect(s.process('</think>after')).toBe('after')
  })

  it('strips bracket-style [thinking] blocks while streaming (drift fix)', () => {
    // Regression: bracket-style reasoning used to be stripped only by the
    // one-shot pass, so it flashed on screen during the stream and then
    // vanished from the saved message. Streaming now derives its tags from
    // the same REASONING_TAGS registry, so it strips them live too.
    const s = new StreamingSanitizer()
    expect(s.process('answer: [thinking]')).toBe('answer: ')
    expect(s.process('debating')).toBe('')
    expect(s.process('[/thinking]42')).toBe('42')
  })

  it('opens the earliest tag when two different tags appear in one buffer', () => {
    const s = new StreamingSanitizer()
    // <reasoning> comes before <think> positionally; must open <reasoning>.
    expect(s.process('x <reasoning>a</reasoning> y <think>')).toBe('x  y ')
    expect(s.process('b</think>z')).toBe('z')
  })

  it('holds back partial opening tag until complete', () => {
    const s = new StreamingSanitizer()
    // "<thi" could be start of <think>, must hold back
    const out = s.process('safe <thi')
    expect(out).toBe('safe ')
    // Continuing — if it's not <think>, it should emerge
    const out2 = s.process('rdpart>')
    expect(out2).toContain('<thirdpart>')
  })

  it('emits buffered content when stream ends mid-reasoning-tag (v2.12.7)', () => {
    const s = new StreamingSanitizer()
    expect(s.process('before <think>')).toBe('before ')
    expect(s.process('unfinished thought')).toBe('')
    // Stream cut off before </think>. The v2.12.6 behaviour was to drop
    // the buffer, but that caused silent "empty message" bubbles after
    // a plan_tasks turn on models that wrap their whole reply in an
    // unclosed <think>. We now emit the buffered text — leaking some
    // reasoning is strictly better than the user seeing nothing.
    const flushed = s.flush()
    expect(flushed).toContain('<think>')
    expect(flushed).toContain('unfinished thought')
    // State is reset — a second flush on an empty buffer returns ''.
    expect(s.flush()).toBe('')
  })

  it('flushes held-back partial tag chars on demand', () => {
    const s = new StreamingSanitizer()
    // "<th" is partial start of <think>, so chars are held back
    const emitted = s.process('hello <th')
    expect(emitted).toBe('hello ')
    // flush() releases the held-back "<th" if stream ends without completing
    expect(s.flush()).toBe('<th')
    expect(s.flush()).toBe('')
  })
})

describe('sanitizeReasoningLeaksSafe', () => {
  it('strips reasoning when real content remains', () => {
    expect(sanitizeReasoningLeaksSafe('<think>plan</think>Hi')).toBe('Hi')
  })

  it('keeps raw text when sanitizing would blank the whole reply', () => {
    // Model wrapped its entire answer in <think> — a reply with visible
    // reasoning beats an empty bubble (v2.12.7 invariant, now encapsulated).
    const raw = '<think>this is everything the model said</think>'
    expect(sanitizeReasoningLeaks(raw)).toBe('')        // one-shot would blank it
    expect(sanitizeReasoningLeaksSafe(raw)).toBe(raw)   // safe keeps it
  })

  it('keeps raw for bracket-style all-reasoning too', () => {
    const raw = '[thinking]only thinking[/thinking]'
    expect(sanitizeReasoningLeaksSafe(raw)).toBe(raw)
  })

  it('returns empty only when the raw input was empty/whitespace', () => {
    expect(sanitizeReasoningLeaksSafe('')).toBe('')
    expect(sanitizeReasoningLeaksSafe('   ')).toBe('')
  })
})

describe('emptyReplyNotice', () => {
  it('returns the English notice for "en"', () => {
    expect(emptyReplyNotice('en')).toContain('empty response')
  })

  it('returns the Portuguese notice for "pt" / anything else', () => {
    expect(emptyReplyNotice('pt')).toContain('resposta vazia')
    expect(emptyReplyNotice('fr')).toContain('resposta vazia')
  })
})

describe('REASONING_TAGS registry consistency', () => {
  // Every declared tag must be stripped by BOTH paths — the guarantee the
  // shared registry exists to enforce. A new format added to REASONING_TAGS
  // is automatically covered here.
  for (const { start, end } of REASONING_TAGS) {
    it(`one-shot strips ${start}…${end}`, () => {
      expect(sanitizeReasoningLeaks(`${start}secret${end}after`)).toBe('after')
    })

    it(`streaming strips ${start}…${end} across chunks`, () => {
      const s = new StreamingSanitizer()
      expect(s.process(`before ${start}`)).toBe('before ')
      expect(s.process(`secret${end}after`)).toBe('after')
    })
  }
})
