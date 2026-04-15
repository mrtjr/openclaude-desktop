import { describe, it, expect } from 'vitest'
import { sanitizeReasoningLeaks, StreamingSanitizer } from '../src/utils/sanitizers'

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

  it('holds back partial opening tag until complete', () => {
    const s = new StreamingSanitizer()
    // "<thi" could be start of <think>, must hold back
    const out = s.process('safe <thi')
    expect(out).toBe('safe ')
    // Continuing — if it's not <think>, it should emerge
    const out2 = s.process('rdpart>')
    expect(out2).toContain('<thirdpart>')
  })

  it('handles stream interrupted inside reasoning block (known leak behavior)', () => {
    const s = new StreamingSanitizer()
    expect(s.process('before <think>')).toBe('before ')
    expect(s.process('unfinished thought')).toBe('')
    // NOTE: If stream ends without </think>, flush() returns the raw buffer
    // (including the opening tag). This is a known limitation — better to
    // surface the leak than freeze on incomplete streams. Downstream callers
    // should render this as plain text (which will visually show "<think>"
    // and let the user see that reasoning was incomplete).
    const flushed = s.flush()
    expect(flushed).toContain('unfinished thought')
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
