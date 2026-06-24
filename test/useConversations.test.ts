// ─── useConversations — flush-on-close tests ────────────────────────
//
// Guards the v2.12.18 data-integrity fix: the 1s debounced save dropped the
// last change if the app closed inside its window. A beforeunload flush now
// writes immediately, using the live ref so it can't save a stale snapshot.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useConversations } from '../src/hooks/useConversations'

describe('useConversations — flush on beforeunload', () => {
  beforeEach(() => {
    ;(window as any).electron = {
      loadConversations: vi.fn().mockResolvedValue([
        {
          id: 'c1',
          title: 'X',
          createdAt: new Date().toISOString(),
          messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: new Date().toISOString() }],
        },
      ]),
      saveConversations: vi.fn().mockResolvedValue({ error: null }),
    }
  })

  it('writes the pending save on beforeunload so the last message is not lost', async () => {
    const { result } = renderHook(() => useConversations())
    await waitFor(() => expect(result.current.conversations.length).toBeGreaterThan(0))
    ;(window.electron.saveConversations as any).mockClear()

    act(() => { window.dispatchEvent(new Event('beforeunload')) })

    expect(window.electron.saveConversations).toHaveBeenCalledTimes(1)
    expect((window.electron.saveConversations as any).mock.calls[0][0][0].id).toBe('c1')
  })

  it('renames a conversation and marks the title as manual', async () => {
    const { result } = renderHook(() => useConversations())
    await waitFor(() => expect(result.current.conversations.length).toBeGreaterThan(0))
    act(() => { result.current.renameConversation('c1', '  Meu  título  ') })
    const c = result.current.conversations.find(x => x.id === 'c1')!
    expect(c.title).toBe('Meu título')
    expect(c.titleManual).toBe(true)
  })

  it('ignores a blank rename (keeps the current title)', async () => {
    const { result } = renderHook(() => useConversations())
    await waitFor(() => expect(result.current.conversations.length).toBeGreaterThan(0))
    act(() => { result.current.renameConversation('c1', '   ') })
    expect(result.current.conversations.find(x => x.id === 'c1')!.title).toBe('X')
  })

  it('saves the latest conversations via the ref, not a stale snapshot', async () => {
    const { result } = renderHook(() => useConversations())
    await waitFor(() => expect(result.current.conversations.length).toBeGreaterThan(0))
    act(() => { result.current.newConversation() })          // add one after mount
    ;(window.electron.saveConversations as any).mockClear()

    act(() => { window.dispatchEvent(new Event('beforeunload')) })

    const saved = (window.electron.saveConversations as any).mock.calls[0][0]
    expect(saved.length).toBe(2) // loaded c1 + the new one — ref is current
  })
})
