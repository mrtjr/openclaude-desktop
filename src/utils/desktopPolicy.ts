// ─── Desktop control risk policy — pure ─────────────────────────────
//
// The agent can now drive the real Windows desktop (open apps, type, send
// keyboard shortcuts) via the computer_* tools. The user chose "confirm only
// RISKY actions" — so common actions run free (even in bypass mode), but
// genuinely consequential ones always ask first, regardless of permission
// level. This classifier is the gate; it's pure + tested.

/** True when a desktop action is consequential enough to ALWAYS confirm with
 *  the user first, even when the permission level would normally skip approval
 *  (e.g. bypass mode). Conservative by design — when unsure, treat as risky. */
export function isRiskyDesktopAction(name: string, args: Record<string, unknown> | null | undefined): boolean {
  // Launching a program is always consequential.
  if (name === 'computer_open_app') return true

  // A keyboard shortcut can close/quit/delete. SendKeys modifiers: ^ = Ctrl,
  // % = Alt. Plain navigation/text keys (Enter, Tab, Esc, Backspace, arrows,
  // Shift+key) are safe and run free.
  if (name === 'computer_press_keys') {
    const k = String((args && (args.keys ?? (args as any).key)) ?? '')
    if (/[\^%]/.test(k)) return true                 // Ctrl/Alt combo
    if (/\{?\s*(DEL(ETE)?|F4)\s*\}?/i.test(k)) return true  // Delete / Alt+F4-style
    return false
  }

  // computer_type_text just types into the focused field — not auto-risky.
  return false
}
