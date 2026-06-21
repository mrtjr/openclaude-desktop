// ─── Guard de SSRF para fetch-url (puro) ────────────────────────────
//
// A varredura (v2.113) confirmou: fetch-url aceitava qualquer http(s) sem
// checar o destino. Um prompt/página maliciosa podia fazer o modelo ler
// http://localhost:porta-admin, http://169.254.169.254 (metadata de nuvem) ou
// http://192.168.x.x (serviços internos da rede do usuário). Aqui ficam os
// classificadores PUROS de IP/host bloqueado; a resolução DNS (impura) e a
// revalidação a cada redirect ficam no main.js.

/** Motivo pelo qual um IP é bloqueado (loopback/privado/link-local/reservado),
 *  ou null se é público. Cobre IPv4 e IPv6 (incl. IPv4-mapeado ::ffff:). */
function ipToBlockReason(ip) {
  let s = String(ip || '').toLowerCase().trim().replace(/^\[|\]$/g, '')
  if (!s) return 'empty'
  // IPv4-mapeado em IPv6 (::ffff:127.0.0.1) → trata como o IPv4.
  const mapped = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) s = mapped[1]
  // IPv6
  if (s.includes(':')) {
    if (s === '::1') return 'loopback'
    if (s === '::') return 'unspecified'
    if (s.startsWith('fe80')) return 'link-local'
    if (/^f[cd]/.test(s)) return 'unique-local' // fc00::/7
    return null
  }
  // IPv4
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = Number(m[1]), b = Number(m[2])
    if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return 'invalid'
    if (a === 127) return 'loopback'
    if (a === 0) return 'unspecified'
    if (a === 10) return 'private'
    if (a === 169 && b === 254) return 'link-local' // inclui metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return 'private'
    if (a === 192 && b === 168) return 'private'
    if (a === 100 && b >= 64 && b <= 127) return 'cgnat' // 100.64.0.0/10
    if (a >= 224) return 'reserved' // multicast/reservado
    return null
  }
  return null // não é IP literal — decidido depois via DNS
}

function isBlockedIp(ip) { return ipToBlockReason(ip) !== null }

/** Motivo do bloqueio para um HOSTNAME literal (antes do DNS): localhost e
 *  variantes, ou um IP literal bloqueado. null = precisa resolver via DNS. */
function hostnameBlockReason(hostname) {
  const h = String(hostname || '').toLowerCase().trim().replace(/^\[|\]$/g, '')
  if (!h) return 'empty'
  if (h === 'localhost' || h.endsWith('.localhost')) return 'localhost'
  return ipToBlockReason(h) // se for IP literal, classifica; senão null
}

module.exports = { ipToBlockReason, isBlockedIp, hostnameBlockReason }
