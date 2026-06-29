import { describe, it, expect, afterAll } from 'vitest'
import http from 'node:http'
import { createRemoteServer } from '../electron/remote-server.js'

const TOKEN = 'integration-token'
const srv = createRemoteServer({
  staticDir: process.cwd(),
  getToken: () => TOKEN,
  getInfo: () => ({ name: 'OpenClaude', version: 'test', targets: [{ id: 'main', label: 'x', provider: 'ollama', model: 'm' }] }),
  // contrato de streaming (callbacks): emite 2 pedaços e finaliza
  chatHandler: (_payload: any, cb: any) => { cb.onChunk('Olá'); cb.onChunk(' mundo'); cb.onDone('Olá mundo', 'm') },
})

function req(method: string, pathname: string, opts: { token?: string; body?: any } = {}): Promise<{ status: number; headers: any; body: string }> {
  return new Promise((resolve) => {
    const data = opts.body ? JSON.stringify(opts.body) : null
    const headers: any = {}
    if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data) }
    const r = http.request({ hostname: '127.0.0.1', port: srv.port(), path: pathname, method, headers }, (res) => {
      let b = ''
      res.on('data', (c) => (b += c))
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: b }))
    })
    r.on('error', () => resolve({ status: 0, headers: {}, body: '' }))
    if (data) r.write(data)
    r.end()
  })
}

describe('createRemoteServer (integration)', () => {
  it('serves /api/health without auth and sets security headers', async () => {
    await srv.start(0, '127.0.0.1')
    const r = await req('GET', '/api/health')
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body).ok).toBe(true)
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['x-frame-options']).toBe('DENY')
  })
  it('rejects /api/info without a token (401) and accepts it with the token', async () => {
    const no = await req('GET', '/api/info')
    expect(no.status).toBe(401)
    const yes = await req('GET', '/api/info', { token: TOKEN })
    expect(yes.status).toBe(200)
    expect(JSON.parse(yes.body).targets).toHaveLength(1)
  })
  it('streams /api/chat as SSE using the onChunk/onDone callbacks', async () => {
    const r = await req('POST', '/api/chat', { token: TOKEN, body: { messages: [{ role: 'user', content: 'oi' }] } })
    expect(r.status).toBe(200)
    expect(String(r.headers['content-type'])).toContain('text/event-stream')
    const deltas = (r.body.match(/"delta"/g) || []).length
    expect(deltas).toBe(2)
    expect(r.body).toContain('"done":true')
    expect(r.body).toContain('Olá mundo')
  })
  afterAll(async () => { await srv.stop() })
})
