// ─── Edit & resend a user message (v2.129.0) ────────────────────────
// ChatGPT-style: the user clicks the pencil on one of their own messages,
// rewrites it, and the conversation re-runs from that point with the new
// text — every message AT and AFTER the edited one is dropped, then the
// edited text is re-sent as a fresh user turn.
//
// This is the pure, unit-tested core: given the message list and the id of
// the user message being edited, return the prefix to keep. App.tsx applies
// it to state and calls sendMessage with the new text. Mirrors the slice the
// existing "regenerate" path does, but anchored on an ARBITRARY user message
// instead of always the last one.

import type { Message } from '../types'

/**
 * The conversation prefix to keep when editing the message `msgId`: every
 * message strictly before it. Re-sending the edited text re-appends a fresh
 * user turn, so the edited message itself is intentionally dropped here.
 *
 * Returns `null` when the id isn't found, so callers can bail without
 * mutating state.
 */
export function sliceBeforeMessage(messages: Message[], msgId: string): Message[] | null {
  const idx = messages.findIndex(m => m.id === msgId)
  if (idx < 0) return null
  return messages.slice(0, idx)
}

/** Only the user's own non-empty messages are editable. */
export function canEditMessage(msg: Message): boolean {
  return msg.role === 'user' && msg.content.trim().length > 0
}

/**
 * The most recent editable user message (skips hidden continuation turns).
 * Powers the ChatGPT "press ↑ on an empty composer to edit your last message"
 * shortcut. Returns null when there's nothing to recall.
 */
export function lastUserMessage(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m.hidden && canEditMessage(m)) return m
  }
  return null
}

/**
 * Decide what an edit should do once the user commits the textarea:
 *  - 'noop'   — the text is unchanged (ignoring surrounding whitespace);
 *               just close the editor, don't churn the conversation.
 *  - 'empty'  — the user cleared the field; treat as a cancel.
 *  - 'resend' — there's new, non-empty text → re-run from this point.
 * `text` is the trimmed value to actually send (only meaningful for 'resend').
 */
export function classifyEdit(original: string, draft: string): { action: 'noop' | 'empty' | 'resend'; text: string } {
  const trimmed = draft.trim()
  if (!trimmed) return { action: 'empty', text: '' }
  if (trimmed === original.trim()) return { action: 'noop', text: trimmed }
  return { action: 'resend', text: trimmed }
}
