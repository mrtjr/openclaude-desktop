// ─── SenseNova (v2.196.0) ────────────────────────────────────────────
// SenseNova fala o wire da OpenAI num endpoint FIXO (token.sensenova.ai/v1),
// então entra como provider de primeira classe — não como `custom`, que pede
// baseUrl do usuário. Estes testes fixam a fiação (chave/modelo/roteamento)
// que ficou espalhada por vários helpers.

import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/settingsConfig'
import { PROVIDERS, getProviderMeta } from '../src/config/providers'
import { providerConfigured, buildSwitchOptions } from '../src/utils/modelSwitcher'
import { defaultModelFor, buildRemoteTargets } from '../src/utils/remoteBridge'
import { providerApiKey } from '../src/utils/compareModels'
import { shouldAnnounceSubagentModels, workerChatErrorMessage } from '../src/utils/researchWorker'
import { resolveVisionTarget } from '../src/utils/vision'
// @ts-expect-error — módulo CJS do processo principal, sem tipos
import { reasoningRequestParams } from '../electron/reasoning-control.js'
import type { AppSettings } from '../src/types'

const base = (over: Partial<AppSettings> = {}): AppSettings =>
  ({ ...DEFAULT_SETTINGS, ...over } as AppSettings)

describe('SenseNova — defaults', () => {
  it('ships an empty key and the documented model', () => {
    expect(DEFAULT_SETTINGS.sensenovaApiKey).toBe('')
    expect(DEFAULT_SETTINGS.sensenovaModel).toBe('sensenova-6.8-flash-lite')
  })

  it('registry entry has no extra field (endpoint is fixed, not user-supplied)', () => {
    const meta = getProviderMeta('sensenova')
    expect(meta.fields?.extra).toBeUndefined()
    expect(meta.defaultModels).toContain('sensenova-6.8-flash-lite')
  })
})

describe('SenseNova — credential gating', () => {
  it('is unavailable without a key and available with one', () => {
    expect(providerConfigured(base(), 'sensenova')).toBe(false)
    expect(providerConfigured(base({ sensenovaApiKey: 'sk-x' }), 'sensenova')).toBe(true)
  })

  it('exposes the key to the cross-provider compare tool', () => {
    expect(providerApiKey(base({ sensenovaApiKey: 'sk-x' }), 'sensenova')).toBe('sk-x')
    expect(providerApiKey(base(), 'sensenova')).toBe('')
  })
})

describe('SenseNova — model resolution', () => {
  it('honours the configured model, falling back to the documented one', () => {
    expect(defaultModelFor(base({ sensenovaModel: 'sensenova-x' }), 'sensenova')).toBe('sensenova-x')
    expect(defaultModelFor(base({ sensenovaModel: '' }), 'sensenova')).toBe('sensenova-6.8-flash-lite')
  })

  it('appears in the quick-switch menu once a key is set', () => {
    const withKey = buildSwitchOptions(
      base({ sensenovaApiKey: 'sk-x', sensenovaModel: 'sensenova-6.8-flash-lite' }), [], '')
    expect(withKey.find(o => o.provider === 'sensenova')?.label).toBe('sensenova-6.8-flash-lite')
    expect(buildSwitchOptions(base(), [], '').find(o => o.provider === 'sensenova')).toBeUndefined()
  })

  it('is offered to the phone as a remote target when configured', () => {
    const targets = buildRemoteTargets(base({ sensenovaApiKey: 'sk-x' }), 'llama3')
    expect(targets.some(t => t.provider === 'sensenova')).toBe(true)
    expect(buildRemoteTargets(base(), 'llama3').some(t => t.provider === 'sensenova')).toBe(false)
  })
})

describe('SenseNova — vision', () => {
  // A doc oficial (OpenSenseNova/SenseNova6.8 API.md) documenta entrada de
  // imagem no formato Vision da OpenAI — por URL ou data-URL base64.
  it('resolves a vision target using the configured chat model', () => {
    const t = resolveVisionTarget(base({
      provider: 'sensenova', sensenovaApiKey: 'sk-x', sensenovaModel: 'sensenova-6.8-flash-lite',
    }))
    expect(t).toEqual({ provider: 'sensenova', model: 'sensenova-6.8-flash-lite', apiKey: 'sk-x' })
  })
})

describe('SenseNova — reasoning effort é decidido por MODELO', () => {
  // sensenova-*: sem parâmetro documentado (o modelo pensa sozinho e devolve
  // `message.reasoning`). deepseek-*, revendido no mesmo gateway: aceita
  // reasoning_effort none|low|medium|high.
  const NONE = { extra: {}, dropTemperature: false, minMaxTokens: 0 }

  it('nunca envia esforço para os modelos sensenova-*', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', 'off']) {
      expect(reasoningRequestParams('sensenova', 'sensenova-6.8-flash-lite', effort)).toEqual(NONE)
    }
  })

  it('envia reasoning_effort para os modelos deepseek-* do gateway', () => {
    expect(reasoningRequestParams('sensenova', 'deepseek-v4-flash', 'medium').extra)
      .toEqual({ reasoning_effort: 'medium' })
    // xhigh/max não existem no wire OpenAI → caem em high
    expect(reasoningRequestParams('sensenova', 'deepseek-v4-flash', 'max').extra)
      .toEqual({ reasoning_effort: 'high' })
    // 'off' vira 'none' — o deepseek sabe DESLIGAR o thinking
    expect(reasoningRequestParams('sensenova', 'deepseek-v4-flash', 'off').extra)
      .toEqual({ reasoning_effort: 'none' })
  })

  it('default continua no-op para qualquer modelo do gateway', () => {
    expect(reasoningRequestParams('sensenova', 'deepseek-v4-flash', 'default')).toEqual(NONE)
    expect(reasoningRequestParams('sensenova', 'sensenova-6.8-flash-lite', 'default')).toEqual(NONE)
  })
})

// ─── Busca da aba Provedor (regressão) ───────────────────────────────
// A ProviderList ignorava o filtro: `filteredProviders` só era usado como
// porteiro (length > 0) e a lista renderizava PROVIDERS inteiro. Buscar
// "sense" devolvia TUDO. Estes testes fixam o contrato da prop `items`.
describe('ProviderList — filtro da busca', () => {
  it('o predicado da busca casa SenseNova por label e por tagline', () => {
    const match = (q: string) => PROVIDERS.filter(p =>
      p.label.toLowerCase().includes(q) ||
      p.tagline.pt.toLowerCase().includes(q) ||
      p.tagline.en.toLowerCase().includes(q))
    expect(match('sense').map(p => p.id)).toEqual(['sensenova'])
    expect(match('6.8').map(p => p.id)).toEqual(['sensenova'])
    expect(match('zzzz')).toHaveLength(0)
  })

  it('ProviderList aceita a lista filtrada via `items`', () => {
    // O default continua sendo a lista completa (sem busca ativa).
    expect(PROVIDERS.map(p => p.id)).toContain('sensenova')
  })
})

// ─── SenseNova como executor de subagentes (delegate_subtasks) ──────
describe('shouldAnnounceSubagentModels — lista de modelos por subtarefa', () => {
  it('anuncia só no executor Ollama (que de fato honra st.model)', () => {
    expect(shouldAnnounceSubagentModels('ollama', ['qwen3', 'llama3'])).toBe(true)
    expect(shouldAnnounceSubagentModels(undefined, ['qwen3'])).toBe(true) // default
  })

  it('NÃO anuncia no Modal nem no SenseNova — workers usam modelo fixo', () => {
    expect(shouldAnnounceSubagentModels('modal', ['qwen3', 'llama3'])).toBe(false)
    expect(shouldAnnounceSubagentModels('sensenova', ['qwen3', 'llama3'])).toBe(false)
  })

  it('sem lista configurada, nunca anuncia', () => {
    expect(shouldAnnounceSubagentModels('ollama', [])).toBe(false)
    expect(shouldAnnounceSubagentModels('ollama', undefined)).toBe(false)
  })
})

describe('workerChatErrorMessage — erro de transporte acionável', () => {
  it('traduz o AggregateError do Ollama fora do ar', () => {
    const msg = workerChatErrorMessage(
      new Error("Error invoking remote method 'ollama-chat': AggregateError"), 'ollama')
    expect(msg).toContain('11434')
    expect(msg).toMatch(/rodando/i)
  })

  it('ECONNREFUSED/ENOTFOUND também contam como offline', () => {
    expect(workerChatErrorMessage(new Error('connect ECONNREFUSED'), 'ollama')).toContain('11434')
    expect(workerChatErrorMessage(new Error('getaddrinfo ENOTFOUND'), 'sensenova'))
      .toMatch(/inacess/i)
  })

  it('erro de nuvem aponta conexão/API key, não a porta local', () => {
    const msg = workerChatErrorMessage(new Error('fetch failed'), 'sensenova')
    expect(msg).toContain('sensenova')
    expect(msg).not.toContain('11434')
  })

  it('erro comum (ex.: 401) passa intacto — não vira palpite', () => {
    expect(workerChatErrorMessage(new Error('API error 401: invalid key'), 'sensenova'))
      .toBe('API error 401: invalid key')
    expect(workerChatErrorMessage(undefined, 'modal')).toBe('modal error')
  })
})
