// ─── Hook: ponte do app do celular (PWA) — v2.193.0 ─────────────────────
//
// Liga o servidor remoto (main) ao motor de chat (renderer). Faz duas coisas:
//  1. Espelha a config + os alvos selecionáveis p/ o main (o /api/info que o
//     celular consulta).
//  2. Escuta 'remote-chat-request' (pedido do celular), roda o chat com a
//     config/chaves LOCAIS e faz STREAMING dos pedaços de volta (v2.193.0).
//
// Streaming reusa providerChatStream/ollamaChatStream + onStreamChunk (o mesmo
// motor do desktop). Cada pedaço vai via remoteChatChunk; o fim via
// remoteChatDone. Isso mantém a conexão do celular viva em respostas longas/lentas
// (ex.: GLM) e mostra os tokens aparecendo ao vivo. Os pedidos do celular são
// sequenciais (o app desativa o envio enquanto responde), então o canal global de
// chunk não colide na prática.

import { useEffect, useRef } from 'react'
import type { AppSettings } from '../types'
import { resolveRemoteConfig, buildRemoteTargets } from '../utils/remoteBridge'
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
    if (!el?.onRemoteChatRequest || !el.remoteChatChunk || !el.remoteChatDone || !el.remoteChatError) return
    const sendChunk = el.remoteChatChunk, sendDone = el.remoteChatDone, sendError = el.remoteChatError
    const off = el.onRemoteChatRequest((req: any) => {
      const id = req?.id
      try {
        const s = settingsRef.current
        const cfg = resolveRemoteConfig(s, req, selectedModelRef.current)
        const messages = Array.isArray(req?.messages) ? req.messages : []
        if (!messages.length) { sendError({ id, error: 'mensagem vazia' }); return }
        if (cfg.isNotOllama && !cfg.apiKey) {
          sendError({ id, error: `Provider "${cfg.provider}" sem chave configurada no desktop.` })
          return
        }
        const maxTokens = Math.min(Number(s.maxTokens) || 4096, 8192)
        let accumulated = ''
        let finished = false
        // Coleta os pedaços do canal global de stream (igual ao desktop). Os
        // pedidos do celular são sequenciais, então não há colisão na prática.
        const cleanup = el.onStreamChunk((c: any) => {
          if (finished) return
          if (c?.done) { finished = true; cleanup(); sendDone({ id, text: accumulated, model: cfg.model }); return }
          if (c?.error) { finished = true; cleanup(); sendError({ id, error: String(c.error) }); return }
          const delta = c?.choices?.[0]?.delta?.content || ''
          if (delta) { accumulated += delta; sendChunk({ id, delta }) }
        })
        const finishOk = () => { if (!finished) { finished = true; cleanup(); sendDone({ id, text: accumulated, model: cfg.model }) } }
        const finishErr = (msg: string) => { if (!finished) { finished = true; cleanup(); sendError({ id, error: msg }) } }
        const stream = cfg.isNotOllama
          ? el.providerChatStream({
              provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model,
              messages, temperature: s.temperature, max_tokens: maxTokens,
              modalHostname: cfg.modalHostname, customBaseUrl: cfg.customBaseUrl,
            })
          : el.ollamaChatStream({ messages, model: cfg.model, temperature: s.temperature, max_tokens: maxTokens })
        // A invoke resolve quando o stream termina (fallback se o 'done' não vier);
        // rejeita em erro pré-stream.
        Promise.resolve(stream).then(finishOk).catch((e: any) => finishErr(e?.message || String(e)))
      } catch (e: any) {
        sendError({ id, error: e?.message || String(e) })
      }
    })
    return () => { if (off) off() }
  }, [])
}
