// ─── Detecção de endereços de rede (helpers puros, testados) ───────────────
//
// Extrai os IPv4 externos das interfaces e marca quais são da Tailscale, para a
// UI montar as URLs de pareamento do app do celular. Separado do main.js para
// ser testável sem Electron (recebe o resultado de os.networkInterfaces()).

/** True se o IP/interface pertence à Tailscale. A tailnet usa a faixa CGNAT
 *  100.64.0.0/10 (100.64.x – 100.127.x) — mais preciso que "qualquer 100.x",
 *  que pegaria IPs fora da tailnet. Também casa pelo nome da interface. */
function isTailscale(address, iface) {
  const a = String(address || '')
  const inCgnat = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)
  return inCgnat || /tailscale/i.test(String(iface || ''))
}

/** Recebe os.networkInterfaces() e devolve [{address, iface, tailscale}] só dos
 *  IPv4 não-internos (descarta loopback/IPv6). */
function pickLocalAddresses(ifaces) {
  const out = []
  for (const name of Object.keys(ifaces || {})) {
    for (const ni of (ifaces[name] || [])) {
      if (ni && ni.family === 'IPv4' && !ni.internal) {
        out.push({ address: ni.address, iface: name, tailscale: isTailscale(ni.address, name) })
      }
    }
  }
  // Tailscale primeiro (é o endereço recomendado p/ acesso remoto), depois LAN.
  return out.sort((a, b) => (b.tailscale ? 1 : 0) - (a.tailscale ? 1 : 0))
}

module.exports = { isTailscale, pickLocalAddresses }
