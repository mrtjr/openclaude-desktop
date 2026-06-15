import { describe, it, expect } from 'vitest'
import { classifyProviderError, humanizeProviderError, isColdStartTimeout } from '../src/utils/providerErrors'

describe('classifyProviderError', () => {
  const cases: Array<[string, string, boolean]> = [
    ['API error 401: {"error":"Unauthorized"}', 'auth', false],
    ['Incorrect API key provided', 'auth', false],
    ['API error 429: rate limit exceeded', 'rate_limit', true],
    ['Too Many Requests', 'rate_limit', true],
    ['Overloaded', 'overloaded', true],
    ['HTTP 503 Service Unavailable', 'overloaded', true],
    ['API error 500: internal server error', 'overloaded', true],
    ['request failed, reason: ECONNRESET', 'network', true],
    ['getaddrinfo ENOTFOUND api.openai.com', 'network', true],
    ['Provider request timeout after 60s', 'timeout', false],
    ["This model's maximum context length is 8192 tokens", 'context', false],
    ['API error 404: model not found', 'not_found', false],
    ['Stream travado: provider parou de enviar conteúdo por 150s (só keep-alive)', 'stall', true],
    ['some totally weird thing', 'unknown', false],
  ]
  it.each(cases)('classifies "%s" as %s (retryable=%s)', (msg, kind, retryable) => {
    const r = classifyProviderError(msg)
    expect(r.kind).toBe(kind)
    expect(r.retryable).toBe(retryable)
  })

  it('marks only rate_limit / overloaded / network as retryable', () => {
    expect(classifyProviderError('429').retryable).toBe(true)
    expect(classifyProviderError('overloaded').retryable).toBe(true)
    expect(classifyProviderError('ECONNRESET').retryable).toBe(true)
    expect(classifyProviderError('401').retryable).toBe(false)
    expect(classifyProviderError('timeout').retryable).toBe(false)
    expect(classifyProviderError('context length').retryable).toBe(false)
  })

  it('handles empty / undefined input', () => {
    expect(classifyProviderError(undefined).kind).toBe('unknown')
    expect(classifyProviderError('').kind).toBe('unknown')
  })

  it('classifica frasings de overflow de contexto por provider (v2.49.0)', () => {
    for (const msg of [
      'context_length_exceeded',
      'This request would exceed the maximum context',
      'prompt is too long: 210000 tokens > 200000',
      'input is too long for requested model',
      'HTTP 413: payload too large',
    ]) {
      expect(classifyProviderError(msg).kind).toBe('context')
    }
  })

  it('classifica stall pela string real do watchdog e é retryável; não colide com timeout', () => {
    // A mensagem real (electron/main.js) NÃO contém "timeout" → não vira 'timeout'.
    const real = 'Stream travado: provider parou de enviar conteúdo por 150s (só keep-alive)'
    expect(classifyProviderError(real)).toEqual({ kind: 'stall', retryable: true })
    // cada fragmento ASCII sozinho também identifica
    expect(classifyProviderError('travado').kind).toBe('stall')
    expect(classifyProviderError('parou de enviar').kind).toBe('stall')
    expect(classifyProviderError('keep-alive').kind).toBe('stall')
  })
})

describe('humanizeProviderError', () => {
  it('returns an actionable message for known kinds (pt + en)', () => {
    expect(humanizeProviderError('HTTP 401', 'pt')).toMatch(/Configurações/)
    expect(humanizeProviderError('HTTP 401', 'en')).toMatch(/Settings/)
    expect(humanizeProviderError('429 rate limit', 'pt')).toMatch(/[Aa]guarde/)
  })

  it('keeps the raw detail (labelled) for unknown errors', () => {
    const out = humanizeProviderError('weird-xyz-error', 'pt')
    expect(out).toContain('weird-xyz-error')
    expect(out).toMatch(/Erro do provedor/)
  })

  it('never returns an empty string', () => {
    expect(humanizeProviderError(undefined, 'en').length).toBeGreaterThan(0)
    expect(humanizeProviderError('Overloaded', 'pt').length).toBeGreaterThan(0)
  })

  it('humaniza o stall com mensagem amigável (não despeja a string crua)', () => {
    const out = humanizeProviderError('Stream travado: provider parou de enviar conteúdo por 150s (só keep-alive)', 'pt')
    expect(out).toMatch(/travou no meio/)
    expect(out).not.toMatch(/Erro do provedor:/) // não é mais "unknown"
  })
})

describe('isColdStartTimeout — auto-retry de timeout de cold-start (v2.26.0)', () => {
  it('timeout SEM conteúdo → refaz (a 1ª tentativa aqueceu o container)', () => {
    expect(isColdStartTimeout('timeout', false)).toBe(true)
  })
  it('timeout COM conteúdo já transmitido → NÃO refaz (duplicaria)', () => {
    expect(isColdStartTimeout('timeout', true)).toBe(false)
  })
  it('só timeout dispara; outros erros não', () => {
    expect(isColdStartTimeout('network', false)).toBe(false)
    expect(isColdStartTimeout('auth', false)).toBe(false)
    expect(isColdStartTimeout('stall', false)).toBe(false)
    expect(isColdStartTimeout('overloaded', false)).toBe(false)
  })
  it('a string real de timeout do provider classifica e habilita o retry', () => {
    const cls = classifyProviderError('Provider request timeout after 300s')
    expect(cls.kind).toBe('timeout')
    expect(isColdStartTimeout(cls.kind, false)).toBe(true)
  })
})
