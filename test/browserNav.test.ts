import { describe, it, expect } from 'vitest'
import { isBenignNavError, resolveNavOutcome, BENIGN_NET_ERRORS } from '../electron/browser-nav.js'

describe('isBenignNavError', () => {
  it('flags ERR_ABORTED (redirect / client navigation) as benign', () => {
    expect(isBenignNavError("ERR_ABORTED (-3) loading 'https://example.com'")).toBe(true)
    expect(isBenignNavError('err_aborted')).toBe(true)
    expect(isBenignNavError('something (-3) happened')).toBe(true)
  })

  it('flags ERR_BLOCKED_BY_CLIENT as benign', () => {
    expect(isBenignNavError('ERR_BLOCKED_BY_CLIENT')).toBe(true)
  })

  it('treats real network failures as NOT benign', () => {
    expect(isBenignNavError('ERR_NAME_NOT_RESOLVED')).toBe(false)
    expect(isBenignNavError('ERR_CONNECTION_REFUSED')).toBe(false)
    expect(isBenignNavError('ERR_INTERNET_DISCONNECTED')).toBe(false)
  })

  it('handles empty / missing messages', () => {
    expect(isBenignNavError('')).toBe(false)
    expect(isBenignNavError(undefined as any)).toBe(false)
    expect(isBenignNavError(null as any)).toBe(false)
  })

  it('exposes the benign code list', () => {
    expect(BENIGN_NET_ERRORS).toContain('ERR_ABORTED')
  })
})

describe('resolveNavOutcome', () => {
  it('clean load → ok, not partial', () => {
    expect(resolveNavOutcome({ finalUrl: 'https://x.com', textLength: 500 }))
      .toEqual({ ok: true, partial: false, note: '' })
  })

  it('benign redirect with a real page → ok, not partial (not a retry)', () => {
    const r = resolveNavOutcome({ error: 'ERR_ABORTED (-3)', finalUrl: 'https://x.com/home', textLength: 0 })
    expect(r.ok).toBe(true)
    expect(r.partial).toBe(false)
  })

  it('timeout but content already rendered → ok + partial', () => {
    const r = resolveNavOutcome({ timedOut: true, finalUrl: 'https://news.com', textLength: 1200 })
    expect(r.ok).toBe(true)
    expect(r.partial).toBe(true)
    expect(r.note).toMatch(/timed out/i)
  })

  it('timeout with a URL but no text still salvages the page', () => {
    const r = resolveNavOutcome({ timedOut: true, finalUrl: 'https://spa.app', textLength: 0 })
    expect(r.ok).toBe(true)
    expect(r.partial).toBe(true)
  })

  it('non-benign error but content present → salvage as partial', () => {
    const r = resolveNavOutcome({ error: 'ERR_SOMETHING', finalUrl: 'https://x.com', textLength: 800 })
    expect(r.ok).toBe(true)
    expect(r.partial).toBe(true)
    expect(r.note).toMatch(/ERR_SOMETHING/)
  })

  it('timeout with nothing rendered → genuine failure', () => {
    const r = resolveNavOutcome({ timedOut: true, finalUrl: 'about:blank', textLength: 0 })
    expect(r.ok).toBe(false)
    expect(r.note).toMatch(/timeout/i)
  })

  it('hard error with a blank page → genuine failure', () => {
    const r = resolveNavOutcome({ error: 'ERR_NAME_NOT_RESOLVED', finalUrl: 'about:blank', textLength: 0 })
    expect(r.ok).toBe(false)
    expect(r.note).toBe('ERR_NAME_NOT_RESOLVED')
  })

  it('treats about:blank as "no real URL"', () => {
    const r = resolveNavOutcome({ error: 'ERR_ABORTED', finalUrl: 'about:blank', textLength: 0 })
    expect(r.ok).toBe(false)
  })

  it('handles being called with no args', () => {
    expect(resolveNavOutcome().ok).toBe(true)
  })
})
