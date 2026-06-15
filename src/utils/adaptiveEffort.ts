// ─── Esforço de raciocínio adaptativo (v2.50.0) ─────────────────────
//
// O "effort" do Claude escala com a dificuldade da tarefa (adaptive thinking:
// o modelo decide quanto pensar por request, dentro do envelope que o usuário
// define). Os providers deste app não expõem thinking adaptativo, então
// aproximamos no cliente: uma heurística PURA que escolhe um nível concreto
// (off/low/medium/high) por turno, a partir de sinais da mensagem. É resolvida
// no renderer ANTES da IPC, então electron/reasoning-control.js continua vendo
// só níveis concretos (nada muda no backend).
//
// É um PROXY barato (sem chamada extra ao modelo), não o thinking real do
// Claude — keyword/length matching erra às vezes. Bilíngue (PT+EN). Determinístico.

export type AdaptiveEffort = 'off' | 'low' | 'medium' | 'high'

const ORDER: AdaptiveEffort[] = ['off', 'low', 'medium', 'high']

/** Limiares de score → nível. Exportados para os testes travarem o comportamento. */
export const EFFORT_THRESHOLDS = { low: 2, medium: 5, high: 8 } as const

// Verbos de tarefa que pedem raciocínio (PT + EN). `\w*` cobre conjugações.
const REASONING_SRC = [
  'refator\\w*', 'depur\\w*', 'debug\\w*', 'otimiz\\w*', 'optimiz\\w*',
  'analis\\w*', 'analyz\\w*', 'analyse\\w*', 'prov\\w*', 'prove',
  'projet\\w*', 'design', 'arquitet\\w*', 'architect\\w*',
  'implement\\w*', 'corrig\\w*', 'consert\\w*', 'fix', 'resolv\\w*', 'solve',
  'investig\\w*', 'compar\\w*', 'explic\\w*', 'explain',
  'estrateg\\w*', 'strateg\\w*', 'planej\\w*', 'refactor\\w*',
].join('|')

// Saudações / agradecimentos curtos → mais rápido.
const TRIVIAL = /^\s*(oi|ol[áa]|e a[íi]|hi|hello|hey|obrigad\w*|valeu|thanks|thank you|ok|blz|beleza|bom dia|boa tarde|boa noite|good morning|good night)\b/i
// Perguntas factuais simples → puxam para baixo.
const SIMPLE_ASK = /\b(o que [ée]|what is|quem [ée]|who is|traduz\w*|translate|defina|define|qual [ée])\b/i

/** Pontua a dificuldade da mensagem. Quanto maior, mais esforço. */
export function scoreEffort(text: string, isAgentMode: boolean): number {
  const t = String(text || '')
  let s = 0
  const len = t.length
  if (len > 80) s += 1
  if (len > 300) s += 1
  if (len > 800) s += 1
  const lines = t.split('\n').length
  if (lines > 4) s += 1
  if (lines > 15) s += 1
  if (/```/.test(t)) s += 4 // bloco de código = sinal forte
  if (/\b[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|cs|rb|php|json|ya?ml|sql|sh|css|html?)\b/i.test(t)) s += 2
  if (/\b(erro|error|exception|traceback|stack\s?trace|stacktrace|panic|segfault|cannot read|is not a function|unhandled)\b/i.test(t)) s += 2
  const verbHits = (t.match(new RegExp(REASONING_SRC, 'gi')) || []).length
  s += Math.min(verbHits, 3) * 2
  if (isAgentMode) s += 2 // tarefa de agente raramente é trivial
  if (SIMPLE_ASK.test(t) && len < 120) s -= 2
  return s
}

/** Resolve o nível concreto de esforço para um turno (modo "auto"). */
export function resolveAdaptiveEffort(input: { text: string; isAgentMode?: boolean; model?: string }): AdaptiveEffort {
  const text = String(input?.text || '')
  const isAgentMode = !!input?.isAgentMode
  // Saudação curta fora do modo agente → o mais rápido possível.
  if (!isAgentMode && TRIVIAL.test(text) && text.trim().length < 40) return 'off'

  const s = scoreEffort(text, isAgentMode)
  let level: AdaptiveEffort =
    s >= EFFORT_THRESHOLDS.high ? 'high' :
    s >= EFFORT_THRESHOLDS.medium ? 'medium' :
    s >= EFFORT_THRESHOLDS.low ? 'low' : 'off'

  // Piso do modo agente: nunca 'off' (há trabalho real em andamento).
  if (isAgentMode && ORDER.indexOf(level) < ORDER.indexOf('low')) level = 'low'
  return level
}
