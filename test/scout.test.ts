import { describe, it, expect } from 'vitest'
import {
  topicKey, keyOverlap, shouldRestart, inferScoutFocus, scoutSystemPrompt,
  pickScoutActivity, ScoutController, SCOUT_MAX_PER_TURN, type RunScout,
  isSpeculativeSearchWorthy, buildScoutQuery, validateScoutResult,
} from '../src/utils/scout'

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('topicKey / overlap / shouldRestart', () => {
  it('extrai palavras de conteúdo (ignora stopwords e curtas)', () => {
    expect([...topicKey('como configurar o websocket no servidor')].sort())
      .toEqual(['configurar', 'servidor', 'websocket'])
  })
  it('retorna conjunto vazio para comandos meta/continuação (continue, continuar, prossiga, next, etc)', () => {
    expect(topicKey('continue').size).toBe(0)
    expect(topicKey('continuar').size).toBe(0)
    expect(topicKey('prossiga').size).toBe(0)
    expect(topicKey('next').size).toBe(0)
    expect(topicKey('pode continuar por favor').size).toBe(0)
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

describe('isSpeculativeSearchWorthy (Classificação Inteligente de Intenção)', () => {
  it('rejeita comandos meta e frases de continuação', () => {
    expect(isSpeculativeSearchWorthy('continue')).toBe(false)
    expect(isSpeculativeSearchWorthy('continuar')).toBe(false)
    expect(isSpeculativeSearchWorthy('prossiga')).toBe(false)
    expect(isSpeculativeSearchWorthy('next')).toBe(false)
  })

  it('rejeita formatação e edições de código mecânicas locais', () => {
    expect(isSpeculativeSearchWorthy('formate o arquivo uPix.pas')).toBe(false)
    expect(isSpeculativeSearchWorthy('renomeie a variável x para y')).toBe(false)
    expect(isSpeculativeSearchWorthy('read_file: C:\\Users\\Dev\\src\\main.ts')).toBe(false)
    expect(isSpeculativeSearchWorthy('list_directory: src/components')).toBe(false)
  })

  it('aceita erros, perguntas técnicas, frameworks e atualizações', () => {
    expect(isSpeculativeSearchWorthy('Erro EDatabaseError ao conectar no Postgres em Delphi')).toBe(true)
    expect(isSpeculativeSearchWorthy('Qual a versão mais recente do React e Vite?')).toBe(true)
    expect(isSpeculativeSearchWorthy('Como implementar WebSocket em TypeScript com SSL')).toBe(true)
    expect(isSpeculativeSearchWorthy('Diferenças entre Supabase e Firebase em 2026')).toBe(true)
  })
})

describe('buildScoutQuery & validateScoutResult', () => {
  it('limpa caminhos locais e prefixos de ferramentas da busca', () => {
    const query = buildScoutQuery(
      'Corrigir erro de conexão Postgres',
      'read_file: C:\\Users\\Dev\\NovoPdv\\src\\uPix.pas'
    )
    expect(query).not.toContain('Users')
    expect(query).not.toContain('read_file')
    expect(query).toContain('postgres')
  })

  it('valida respostas do scout descartando ruídos e aceitando insights reais', () => {
    expect(validateScoutResult('Não consigo determinar o que pesquisar')).toBeNull()
    expect(validateScoutResult('Não foi possível encontrar resultados')).toBeNull()
    expect(validateScoutResult('Curto')).toBeNull()
    expect(validateScoutResult('React 20.2 lançado em maio de 2026 com suporte nativo a server actions.')).toBe(
      'React 20.2 lançado em maio de 2026 com suporte nativo a server actions.'
    )
  })
})

describe('pickScoutActivity (v2.86.0 — ação, não prosa)', () => {
  const sum = (name: string, args: any) => (args?.url || args?.query || args?.command || '')

  it('pega a ÚLTIMA ferramenta chamada (nome + arg), ignorando a prosa', () => {
    const msgs = [
      { role: 'user', content: 'investigue imperiodabritannia.com' },
      { role: 'assistant', content: 'Excelente! Agora vou olhar o domínio…', tool_calls: [{ function: { name: 'browser_navigate', arguments: JSON.stringify({ url: 'imperiodabritannia.com/formulario' }) } }] },
    ]
    expect(pickScoutActivity(msgs, 1, sum)).toBe('browser_navigate: imperiodabritannia.com/formulario')
  })

  it('prosa pura (sem tool call) → vazio (foco fica só no objetivo)', () => {
    const msgs = [
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Excelente! Agora vou…' },
    ]
    expect(pickScoutActivity(msgs, 1, sum)).toBe('')
  })

  it('respeita baseLen (ignora ações de turnos anteriores)', () => {
    const msgs = [
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'web_search', arguments: '{"query":"antigo"}' } }] },
      { role: 'user', content: 'novo pedido' },
    ]
    expect(pickScoutActivity(msgs, 1, sum)).toBe('')
  })

  it('tolera args malformados e arguments como objeto', () => {
    const msgs = [{ role: 'assistant', tool_calls: [{ function: { name: 'execute_command', arguments: { command: 'npm test' } } }] }]
    expect(pickScoutActivity(msgs, 0, sum)).toBe('execute_command: npm test')
    const bad = [{ role: 'assistant', tool_calls: [{ function: { name: 'x', arguments: '{nope' } }] }]
    expect(pickScoutActivity(bad, 0, sum)).toBe('x')
    expect(pickScoutActivity(undefined, 0, sum)).toBe('')
  })
})

describe('inferScoutFocus / scoutSystemPrompt', () => {
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
    c.step('react hooks versao', 'react hooks versao', async () => { calls++; return 'x' }, () => true)
    expect(calls).toBe(0)
  })

  it('inicia em ociosidade, guarda o resultado para o loop consumir', async () => {
    const c = new ScoutController()
    c.reset(true)
    c.step('última versão do React', 'última versão do React', okScout('React 20.2 saiu hoje em versão estável'), () => true)
    expect(c.busy).toBe(true)
    await flush()
    expect(c.busy).toBe(false)
    expect(c.takeResult()).toEqual({ topic: 'ultima versao react', text: 'React 20.2 saiu hoje em versão estável' })
    expect(c.takeResult()).toBeNull() // consumido 1x
  })

  it('não compete por vaga: canStart=false não inicia', () => {
    const c = new ScoutController()
    c.reset(true)
    let calls = 0
    c.step('versao react docs', 'versao react docs', async () => { calls++; return 'x' }, () => false)
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
    c.step('versao react hooks', 'versao react hooks', slow, () => true)
    expect(c.busy).toBe(true)
    c.pause()
    await flush()
    expect(signalSeen!.aborted).toBe(true)
    expect(c.busy).toBe(false)
    expect(c.takeResult()).toBeNull()
  })

  it('respeita o teto por turno', () => {
    const c = new ScoutController()
    c.reset(true)
    let calls = 0
    const distinct = [
      'erro react alpha docs',
      'erro bitcoin beta docs',
      'erro vite gamma docs',
      'erro docker delta docs',
      'erro python epsilon docs',
      'erro rust zeta docs',
      'erro golang eta docs',
    ]
    for (const t of distinct) c.step(t, t, async () => { calls++; return null }, () => true)
    expect(calls).toBe(SCOUT_MAX_PER_TURN)
  })
})
