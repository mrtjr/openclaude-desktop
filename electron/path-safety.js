// ─── Segurança de caminho (puro) ────────────────────────────────────
//
// A varredura (v2.112) confirmou que isPathSafe usava `resolved.startsWith(b)`
// cru: (1) NÃO era segment-aware (`~/.sshfoo` casava `.ssh`); (2) não resolvia
// symlink (um link `docs/evil → /` permitia ler `/etc/passwd` via
// `docs/evil/etc/passwd`); (3) faltavam alvos (/etc/sudoers, /root, UNC do
// Windows). Aqui ficam os helpers PUROS (lista + matching segment-aware + UNC);
// a resolução de symlink (realpath, impura) fica no main.js antes de chamar.

const path = require('path')

/** Caminho UNC do Windows (\\server\share) — pode alcançar share de rede. */
function isUncPath(p) {
  const s = String(p || '')
  return /^\\\\/.test(s) || /^\/\//.test(s)
}

/** `p` é IGUAL a `base` ou está DENTRO dele (segment-aware, case-insensitive,
 *  separador-agnóstico). Evita o falso-positivo do startsWith cru (`.sshfoo` vs
 *  `.ssh`) e trata `\` e `/` como equivalentes. */
function isWithin(p, base) {
  const norm = (s) => String(s).toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
  const a = norm(p), b = norm(base)
  if (!b) return false
  if (a === b) return true
  return a.startsWith(b + '/')
}

/** Diretórios/arquivos sensíveis bloqueados. */
function blockedList(homedir, platform) {
  const join = (...xs) => path.join(homedir, ...xs)
  const list = [
    join('.ssh'), join('.gnupg'), join('.aws'), join('.config', 'gcloud'),
    join('.config', 'git'), join('.env'),
  ]
  if (platform === 'win32') {
    list.push('C:\\Windows\\System32', 'C:\\Windows\\SysWOW64')
  } else {
    list.push('/etc/shadow', '/etc/passwd', '/etc/sudoers', '/etc/sudoers.d', '/root', '/boot')
  }
  return list
}

/** O caminho JÁ RESOLVIDO (idealmente via realpath) é proibido? */
function isBlockedPath(resolved, homedir, platform) {
  if (platform === 'win32' && isUncPath(resolved)) return true
  for (const b of blockedList(homedir, platform)) {
    if (isWithin(resolved, b)) return true
  }
  return false
}

/** Guard COMPLETO: resolve o caminho (seguindo symlink, para um link
 *  `docs/evil -> /` nao driblar a lista) e diz se pode ser tocado. Mora aqui, e
 *  nao no main.js, porque handlers em outros modulos (ipc-document) precisam da
 *  MESMA regra — ter duas copias e como as portas de leitura divergem. */
function isPathSafe(filePath) {
  const fs = require('fs')
  const os = require('os')
  let resolved = path.resolve(String(filePath || ''))
  try {
    resolved = fs.realpathSync(resolved)
  } catch (e) {
    // Nao existe ainda (write/edit de arquivo novo): resolve o PAI real.
    try { resolved = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved)) }
    catch (e2) { /* pai tambem nao existe — usa o resolved literal */ }
  }
  return !isBlockedPath(resolved, os.homedir(), process.platform)
}

module.exports = { isUncPath, isWithin, blockedList, isBlockedPath, isPathSafe }
