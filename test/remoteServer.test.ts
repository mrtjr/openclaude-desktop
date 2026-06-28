import { describe, it, expect } from 'vitest'
import {
  mimeFor, generateToken, tokenMatches, extractToken, resolveStaticPath, parseChatBody,
} from '../electron/remote-server.js'
import path from 'node:path'

describe('mimeFor', () => {
  it('maps known extensions', () => {
    expect(mimeFor('index.html')).toBe('text/html; charset=utf-8')
    expect(mimeFor('app.js')).toBe('text/javascript; charset=utf-8')
    expect(mimeFor('style.css')).toBe('text/css; charset=utf-8')
    expect(mimeFor('site.webmanifest')).toBe('application/manifest+json')
    expect(mimeFor('icon.png')).toBe('image/png')
  })
  it('never falls back to text/html for unknown types (no arbitrary-file-as-page)', () => {
    expect(mimeFor('weird.xyz')).toBe('application/octet-stream')
    expect(mimeFor('noext')).toBe('application/octet-stream')
    expect(mimeFor('')).toBe('application/octet-stream')
  })
})

describe('generateToken', () => {
  it('produces a long, url-safe, unique token each time', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(24)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/) // base64url alphabet
  })
})

describe('tokenMatches', () => {
  it('matches identical tokens', () => {
    expect(tokenMatches('abc123', 'abc123')).toBe(true)
  })
  it('rejects different tokens', () => {
    expect(tokenMatches('abc123', 'abc124')).toBe(false)
    expect(tokenMatches('abc', 'abc123')).toBe(false) // different length
  })
  it('rejects empty / missing sides (no auth bypass with blank token)', () => {
    expect(tokenMatches('', 'abc')).toBe(false)
    expect(tokenMatches('abc', '')).toBe(false)
    expect(tokenMatches('', '')).toBe(false)
    expect(tokenMatches(undefined as any, 'abc')).toBe(false)
    expect(tokenMatches(null as any, null as any)).toBe(false)
  })
})

describe('extractToken', () => {
  const mkUrl = (u: string) => new URL(u, 'http://localhost')
  it('reads a Bearer token from the Authorization header', () => {
    const req = { headers: { authorization: 'Bearer secret-xyz' } }
    expect(extractToken(req, mkUrl('/api/chat'))).toBe('secret-xyz')
  })
  it('reads ?token= from the query string (PWA navigation case)', () => {
    const req = { headers: {} }
    expect(extractToken(req, mkUrl('/api/chat?token=qsecret'))).toBe('qsecret')
  })
  it('prefers the Authorization header over the query', () => {
    const req = { headers: { authorization: 'Bearer hdr' } }
    expect(extractToken(req, mkUrl('/api/chat?token=qs'))).toBe('hdr')
  })
  it('returns empty string when no token is present', () => {
    expect(extractToken({ headers: {} }, mkUrl('/api/chat'))).toBe('')
  })
})

describe('resolveStaticPath', () => {
  const root = path.normalize('/srv/mobile')
  it("maps '/' to index.html", () => {
    expect(resolveStaticPath(root, '/')).toBe(path.join(root, 'index.html'))
  })
  it('resolves nested files under the root', () => {
    expect(resolveStaticPath(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'))
  })
  it('BLOCKS path traversal with ..', () => {
    expect(resolveStaticPath(root, '/../secret.txt')).toBeNull()
    expect(resolveStaticPath(root, '/../../etc/passwd')).toBeNull()
    expect(resolveStaticPath(root, '/assets/../../escape')).toBeNull()
  })
  it('blocks encoded traversal', () => {
    expect(resolveStaticPath(root, '/%2e%2e/secret')).toBeNull()
  })
  it('returns null for malformed percent-encoding', () => {
    expect(resolveStaticPath(root, '/%')).toBeNull()
  })
})

describe('parseChatBody', () => {
  it('accepts a valid messages array and normalizes roles', () => {
    const r = parseChatBody(JSON.stringify({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'oi' },
        { role: 'assistant', content: 'olá' },
        { role: 'weird', content: 'fallback to user' },
      ],
      model: 'gpt-x',
    }))
    expect(r.ok).toBe(true)
    expect(r.value!.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(r.value!.model).toBe('gpt-x')
  })
  it('rejects invalid JSON', () => {
    expect(parseChatBody('{not json').ok).toBe(false)
  })
  it('rejects an empty or missing messages array', () => {
    expect(parseChatBody(JSON.stringify({ messages: [] })).ok).toBe(false)
    expect(parseChatBody(JSON.stringify({})).ok).toBe(false)
  })
  it('drops messages without string content and empties', () => {
    const r = parseChatBody(JSON.stringify({ messages: [{ role: 'user', content: 123 }, { role: 'user', content: '' }] }))
    expect(r.ok).toBe(false) // nothing valid left
  })
  it('keeps only valid messages when mixed', () => {
    const r = parseChatBody(JSON.stringify({ messages: [{ role: 'user', content: 'ok' }, { role: 'user', content: null }] }))
    expect(r.ok).toBe(true)
    expect(r.value!.messages).toHaveLength(1)
  })
  it('caps very long message content', () => {
    const big = 'x'.repeat(200000)
    const r = parseChatBody(JSON.stringify({ messages: [{ role: 'user', content: big }] }))
    expect(r.ok).toBe(true)
    expect(r.value!.messages[0].content.length).toBe(100000)
  })
})
