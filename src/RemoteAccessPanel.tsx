// ─── Painel "Conectar celular" (PWA) — v2.191.0 ──────────────────────────
// Liga/desliga o servidor remoto e mostra a URL + código de pareamento p/ abrir
// o app no iPhone. Com o Tailscale rodando nos dois lados, o celular acessa
// http://<ip-tailnet>:porta/?token=… de QUALQUER rede ou dados móveis — a tailnet
// já é criptografada (WireGuard), sem precisar de tailscale serve nem porta
// aberta no roteador. O token aleatório é defesa extra.

import { useEffect, useState, useCallback } from 'react'
import { Smartphone, Copy, Check, RefreshCw, Power } from 'lucide-react'

interface Addr { address: string; iface: string; tailscale: boolean }
interface Status { running: boolean; port: number; token: string; addresses: Addr[] }

const DEFAULT_PORT = 8765

export function RemoteAccessPanel({ pt }: { pt: boolean }) {
  const [status, setStatus] = useState<Status>({ running: false, port: 0, token: '', addresses: [] })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string>('')

  const refresh = useCallback(async () => {
    const s = await window.electron?.remoteServerStatus?.()
    if (s) setStatus(s)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const toggle = async () => {
    setBusy(true)
    try {
      if (status.running) { await window.electron?.remoteServerStop?.() }
      else { await window.electron?.remoteServerStart?.({ port: DEFAULT_PORT }) }
      await refresh()
    } finally { setBusy(false) }
  }

  const regen = async () => {
    setBusy(true)
    try { await window.electron?.remoteServerRegenToken?.(); await refresh() }
    finally { setBusy(false) }
  }

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500) } catch { /* clipboard bloqueado */ }
  }

  // Endereço preferido: Tailscale (acessível de qualquer rede); senão a LAN.
  const tail = status.addresses.find(a => a.tailscale)
  const lan = status.addresses.find(a => !a.tailscale)
  const port = status.port || DEFAULT_PORT
  const urlFor = (a?: Addr) => a ? `http://${a.address}:${port}/?token=${status.token}` : ''
  const tailUrl = urlFor(tail)
  const lanUrl = urlFor(lan)

  const L = (p: string, e: string) => (pt ? p : e)

  return (
    <div className="settings-group">
      <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Smartphone size={16} /> <span>{L('App do celular (iPhone/Android)', 'Mobile app (iPhone/Android)')}</span>
      </label>
      <p className="settings-hint" style={{ marginTop: 4 }}>
        {L(
          'Use seu desktop como servidor de IA pelo celular — a IA local e a principal, de qualquer rede. Requer o app aberto no PC.',
          'Use your desktop as an AI server from your phone — the local and main AI, on any network. Requires the desktop app open.'
        )}
      </p>

      <button
        className="settings-btn"
        onClick={toggle}
        disabled={busy}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
          background: status.running ? 'var(--danger, #c0392b)' : 'var(--accent)',
          color: '#fff', border: 'none', padding: '9px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
        }}
      >
        <Power size={15} />
        {busy ? '…' : status.running ? L('Desligar servidor', 'Stop server') : L('Ligar servidor', 'Start server')}
      </button>

      {status.running && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Passo 1 — Tailscale */}
          <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            <b>{L('Passo 1 — Tailscale (uma vez):', 'Step 1 — Tailscale (one-time):')}</b><br />
            {L('Instale o ', 'Install ')}
            <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Tailscale</a>
            {L(' no PC e no iPhone e entre na MESMA conta. Isso liga os dois numa rede privada que funciona em dados móveis.',
               ' on the PC and the iPhone and sign in to the SAME account. That links them on a private network that works on mobile data.')}
          </div>

          {/* Passo 2 — abrir a URL */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {L('Passo 2 — abra esta URL no Safari do iPhone:', 'Step 2 — open this URL in Safari on the iPhone:')}
            </div>
            {tailUrl ? (
              <PairRow label="Tailscale" value={tailUrl} copied={copied === 'tail'} onCopy={() => copy(tailUrl, 'tail')} />
            ) : (
              <p className="settings-hint" style={{ color: 'var(--danger, #c0392b)' }}>
                {L('Tailscale ainda não detectado neste PC. Instale e conecte; depois reabra este painel.',
                   'Tailscale not detected on this PC yet. Install and connect, then reopen this panel.')}
              </p>
            )}
            {lanUrl && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #888)', marginBottom: 4 }}>
                  {L('Ou, no mesmo Wi-Fi de casa:', 'Or, on the same home Wi-Fi:')}
                </div>
                <PairRow label="LAN" value={lanUrl} copied={copied === 'lan'} onCopy={() => copy(lanUrl, 'lan')} />
              </div>
            )}
          </div>

          {/* Passo 3 — instalar */}
          <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            <b>{L('Passo 3 — instale o app:', 'Step 3 — install the app:')}</b><br />
            {L('No Safari, toque em Compartilhar → "Adicionar à Tela de Início". Vira um app com ícone, em tela cheia.',
               'In Safari, tap Share → "Add to Home Screen". It becomes a full-screen app with an icon.')}
          </div>

          {/* Código de pareamento (caso prefira digitar) */}
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #888)', marginBottom: 4 }}>
              {L('Código de pareamento (se preferir colar na tela do app):', 'Pairing code (if you prefer to paste it in the app):')}
            </div>
            <PairRow label="token" value={status.token} copied={copied === 'tok'} onCopy={() => copy(status.token, 'tok')} mono />
          </div>

          <button
            className="settings-btn"
            onClick={regen}
            disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}
          >
            <RefreshCw size={13} /> {L('Gerar novo código (desconecta os celulares atuais)', 'Generate new code (disconnects current phones)')}
          </button>
        </div>
      )}
    </div>
  )
}

function PairRow({ label, value, copied, onCopy, mono }: { label: string; value: string; copied: boolean; onCopy: () => void; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <code style={{
        flex: 1, fontSize: mono ? 12 : 12.5, background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '8px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)',
      }} title={value}>{value}</code>
      <button
        onClick={onCopy}
        aria-label={`Copiar ${label}`}
        style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 8, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: copied ? 'var(--ok, #2ecc71)' : 'var(--text-secondary)', cursor: 'pointer' }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  )
}
