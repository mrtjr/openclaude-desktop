import { describe, it, expect } from 'vitest'
import {
  topicKey, keyOverlap, shouldRestart, inferScoutFocus, scoutSystemPrompt,
  ScoutController, SCOUT_MAX_PER_TURN, type RunScout,
} from '../src/utils/scout'

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('topicKey / overlap / shouldRestart', () => {
  it('extrai palavras de conteúdo (ignora stopwords e curtas)', () => {
    expect([...topicKey('como configurar o websocket no servidor')].sort())
      .toEqual(['configurar', 'servidor', 'websocket'])
  })
  it('mesmo tema → não reinicia; tema diferente → reinicia', () => {
    const running = topicKey('última versão do React e hooks')
    expect(shouldRestart(topicKey('qual a versão atual do React'), running)).toBe(false)
    expect(shouldRestart(topicKey('preço do bitcoin hoje'), running)).toBe(true)
    expect(shouldRestart(topicKey('algo'), null)).toBe(true) // nada rodando
  })
  it('keyOverlap é Jaccard', () => {
    expect(keyOverlap(topicKey('react hooks'), topicKey('react hooks'))).toBe(1)
    expect(keyOverlap(topicKey('react'), topicKey('bitcoin'))).toBe(0)
  })
})

describe('inferScoutFocus / scoutSystemPrompt', () => {
  it('junta objetivo + atividade', () => {
    expect(inferScoutFocus('migrar p/ Vite 7', 'lendo vite.config')).toBe('migrar p/ Vite 7 — lendo vite.config')
  })
  it('o prompt carrega a data de hoje e foca em frescor', () => {
    const p = scoutSystemPrompt('pt', '2026-06-17')
    expect(p).toContain('2026-06-17')
    expect(p.toLowerCase()).toContain('atual')
    expect(scoutSystemPrompt('en', '2026-06-17')).toContain('training data')
  })
})

describe('ScoutController', () => {
  const okScout = (text: string): RunScout => async () => text

  it('não roda se desligado', () => {
    const c = new ScoutController()
    c.reset(false)
    let calls = 0
    c.step('react hooks', async () => { calls++; return 'x' }, () => true)
    expect(calls).toBe(0)
  })

  it('inicia em ociosidade, guarda o resultado para o loop consumir', async () => {
    const c = new ScoutController()
    c.reset(true)
    c.step('última versão do React', okScout('React 20.2 saiu hoje'), () => true)
    expect(c.busy).toBe(true)
    await flush()
    expect(c.busy).toBe(false)
    expect(c.takeResult()).toEqual({ topic: 'última versão do React', text: 'React 20.2 saiu hoje' })
    expect(c.takeResult()).toBeNull() // consumido 1x
  })

  it('não compete por vaga: canStart=false não inicia', () => {
    const c = new ScoutController()
    c.reset(true)
    let calls = 0
    c.step('tema', async () => { calls++; return 'x' }, () => false)
    expect(calls).toBe(0)
    expect(c.busy).toBe(false)
  })

  it('pausa (delegação) aborta a pesquisa em voo e descarta o resultado', async () => {
    const c = new ScoutController()
    c.reset(true)
    let signalSeen: AbortSignal | null = null
    const slow: RunScout = (_t, signal) => new Promise((resolve) => {
      signalSeen = signal
      signal.addEventListener('abort', () => resolve(null))
    })
    c.step('tema A', slow, () => true)
    expect(c.busy).toBe(true)
    c.pause()
    await flush()
    expect(signalSeen!.aborted).toBe(true)
    expect(c.busy).toBe(false)
    expect(c.takeResult()).toBeNull()
  })

  it('reinicia quando o tema muda claramente; mantém no mesmo tema', () => {
    const c = new ScoutController()
    c.reset(true)
    const started: string[] = []
    const hold: RunScout = (t) => { started.push(t); return new Promise(() => {}) } // nunca resolve
    c.step('versão do React hooks', hold, () => true)
    c.step('React hooks ainda', hold, () => true) // mesmo tema → não relança
    expect(started.length).toBe(1)
    c.step('preço do bitcoin agora', hold, () => true) // tema novo → relança
    expect(started.length).toBe(2)
  })

  it('resolução tardia de um run supersedido não zera o busy do run novo', async () => {
    const c = new ScoutController()
    c.reset(true)
    let resolveA: ((v: string) => void) | null = null
    const controllable: RunScout = (t) =>
      t.includes('react')
        ? new Promise<string>((res) => { resolveA = res }) // A: resolvível à mão
        : new Promise<string>(() => {}) // B: nunca resolve
    c.step('versão do react hooks', controllable, () => true) // scout A
    expect(c.busy).toBe(true)
    c.step('preço do bitcoin agora', controllable, () => true) // tema novo → B (aborta A)
    expect(c.busy).toBe(true)
    resolveA!('texto tardio do A') // A resolve DEPOIS de ser supersedido
    await flush()
    expect(c.busy).toBe(true) // B ainda roda — não foi zerado pela resolução tardia de A
    expect(c.takeResult()).toBeNull() // o resultado de A (abortado) é descartado
  })

  it('respeita o teto por turno', () => {
    const c = new ScoutController()
    c.reset(true)
    let calls = 0
    const distinct = ['react alpha', 'bitcoin beta', 'vite gamma', 'docker delta', 'python epsilon', 'rust zeta', 'golang eta']
    for (const t of distinct) c.step(t, async () => { calls++; return null }, () => true)
    expect(calls).toBe(SCOUT_MAX_PER_TURN)
  })
})
