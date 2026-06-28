// ─── Hook: ponte do app do celular (PWA) — v2.191.0 ─────────────────────
//
// Liga o servidor remoto (main) ao motor de chat (renderer). Faz duas coisas:
//  1. Espelha a config atual (provider/modelo) p/ o main, p/ o /api/info que o
//     celular consulta ao parear.
//  2. Escuta 'remote-chat-request' (pedido vindo do celular), roda o chat com a
//     config/chaves LOCAIS do usuário e devolve o texto via remoteChatReply.
//
// v1 é NÃO-streaming (o providerChat/ollamaChat retorna o texto completo) — isso
// evita colidir com o canal de streaming compartilhado quando o usuário também
// está usando o desktop. Streaming de verdade fica p/ um incremento seguinte.

import { useEffect, useRef } from 'react'
import type { AppSettings } from '../types'
import { resolveRemoteConfig, buildRemoteTargets } from '../utils/remoteBridge'
import { extractChatText } from '../utils/compareModels'
import { getDisplayModel } from './useProviderConfig'

export function useRemoteBridge(settings: AppSettings, selectedModel: string) {
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel

  // (1) Espelha a config atual + alvos selecionáveis p/ o /api/info do celular.
  useEffect(() => {
    const provider = settings.provider || 'ollama'
    const model = getDisplayModel(settings, selectedModel)
    const targets = buildRemoteTargets(settings, selectedModel)
    window.electron?.remoteServerConfig?.({ provider, model, models: model ? [model] : [], targets })
  }, [settings, selectedModel])

  // (2) Registra o handler de pedidos do celular (uma vez; lê estado via refs).
  useEffect(() => {
    const el = window.electron
    if (!el?.onRemoteChatRequest || !el.remoteChatReply) return
    const reply = el.remoteChatReply
    const off = el.onRemoteChatRequest(async (req: any) => {
      const id = req?.id
      try {
        const s = settingsRef.current
        const cfg = resolveRemoteConfig(s, req, selectedModelRef.current)
        const messages = Array.isArray(req?.messages) ? req.messages : []
        if (!messages.length) { reply({ id, error: 'mensagem vazia' }); return }
        const maxTokens = Math.min(Number(s.maxTokens) || 4096, 8192)
        let res: any
        if (cfg.isNotOllama) {
          if (!cfg.apiKey) {
            reply({ id, error: `Provider "${cfg.provider}" sem chave configurada no desktop.` })
            return
          }
          res = await el.providerChat({
            provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model,
            messages, temperature: s.temperature, max_tokens: maxTokens,
            modalHostname: cfg.modalHostname, customBaseUrl: cfg.customBaseUrl,
          })
        } else {
          res = await el.ollamaChat({ messages, model: cfg.model, temperature: s.temperature, max_tokens: maxTokens })
        }
        if (res?.error) { reply({ id, error: String(res.error) }); return }
        const text = extractChatText(res)
        reply({ id, text: text || '(sem resposta)', model: cfg.model })
      } catch (e: any) {
        reply({ id, error: e?.message || String(e) })
      }
    })
    return () => { if (off) off() }
  }, [])
}
