/**
 * useConversationFork.ts — v2.2.1
 * Hook para bifurcar conversas a partir de qualquer mensagem.
 *
 * Uso:
 *   const { forkFrom } = useConversationFork({ conversationsRef, setConversations, setActiveConvId })
 *   // No botão 'Fork aqui' de cada mensagem:
 *   forkFrom(conversationId, messageIndex)
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
  createdAt?: any
  updatedAt?: number
  forkedFrom?: { conversationId: string; messageIndex: number }
  [key: string]: any
}

interface UseForkParams {
  conversationsRef:  React.MutableRefObject<Conversation[]>
  setConversations:  React.Dispatch<React.SetStateAction<Conversation[]>>
  setActiveConvId:   React.Dispatch<React.SetStateAction<string | null>>
}

export function useConversationFork({
  conversationsRef,
  setConversations,
  setActiveConvId,
}: UseForkParams) {

  const forkFrom = useCallback(
    (conversationId: string, messageIndex: number) => {
      // Use ref for latest conversations to avoid stale closures
      const source = conversationsRef.current.find(c => c.id === conversationId)
      if (!source) return

      // Clone messages up to and including messageIndex
      const forkedMessages: Message[] = source.messages
        .slice(0, messageIndex + 1)
        .map(m => ({ ...m }))

      const newId = `fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const now = Date.now()

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
      setActiveConvId(newId)
    },
    [conversationsRef, setConversations, setActiveConvId]
  )

  return { forkFrom }
}
