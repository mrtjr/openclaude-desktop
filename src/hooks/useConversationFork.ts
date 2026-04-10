/**
 * useConversationFork.ts — v1.9.0
 * Hook para bifurcar conversas a partir de qualquer mensagem.
 *
 * Uso:
 *   const { forkFrom } = useConversationFork({ conversations, setConversations, setCurrentConversationId })
 *   // No botão 'Fork aqui' de cada mensagem:
 *   forkFrom(conversationId, messageIndex)
 *
 * O fork:
 *  1. Clona o array de mensagens de 0 até messageIndex (inclusive)
 *  2. Cria uma nova conversa com título "Fork: <título original> (msg N)"
 *  3. Adiciona a nova conversa ao topo da lista
 *  4. Seleciona a nova conversa automaticamente
 */
import { useCallback } from 'react'

interface Message {
  role: string
  content: any
  [key: string]: any
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt?: number
  updatedAt?: number
  forkedFrom?: { conversationId: string; messageIndex: number }
  [key: string]: any
}

interface UseForkParams {
  conversations:            Conversation[]
  setConversations:         React.Dispatch<React.SetStateAction<Conversation[]>>
  setCurrentConversationId: React.Dispatch<React.SetStateAction<string>>
}

export function useConversationFork({
  conversations,
  setConversations,
  setCurrentConversationId,
}: UseForkParams) {

  const forkFrom = useCallback(
    (conversationId: string, messageIndex: number) => {
      const source = conversations.find(c => c.id === conversationId)
      if (!source) return

      // Clone messages up to and including messageIndex
      const forkedMessages: Message[] = source.messages
        .slice(0, messageIndex + 1)
        .map(m => ({ ...m }))

      const newId = `fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const now   = Date.now()

      const newConversation: Conversation = {
        ...source,
        id:         newId,
        title:      `Fork: ${source.title} (msg ${messageIndex + 1})`,
        messages:   forkedMessages,
        createdAt:  now,
        updatedAt:  now,
        forkedFrom: { conversationId, messageIndex },
      }

      setConversations(prev => [newConversation, ...prev])
      setCurrentConversationId(newId)

      // Persist asynchronously
      const el = (window as any).electron
      if (el?.saveConversations) {
        el.saveConversations(
          [newConversation, ...conversations].slice(0, 200)
        ).catch(() => {})
      }
    },
    [conversations, setConversations, setCurrentConversationId]
  )

  return { forkFrom }
}
