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

// ─── Caminhos protegidos em tempo de execução ───────────────────────
// Arquivos que um módulo do main passou a usar para guardar SEGREDO — ex.: o
// .env com a DATABASE_URL do postgres_query. Sem isto, read_file (que roda sem
// aprovação) lia a senha do banco e a entregava ao modelo. O módulo é único no
// processo, então main.js e ipc-document enxergam a mesma lista.
const runtimeProtected = new Set()

/** Forma canônica NATIVA: absoluto, symlinks resolvidos e, no Windows, nome
 *  longo (JNIOR~1 → Júnior) e sem sufixo de stream NTFS (`.env::$DATA` abre o
 *  próprio .env). O realpath JS não faz nenhuma das duas coisas — só o .native.
 *  Para o que ainda não existe, canoniza o ancestral mais próximo que existe e
 *  limpa os nomes restantes (stream, ponto/espaço final que o Windows ignora). */
function nativeCanonical(p) {
  const fs = require('fs')
  const real = fs.realpathSync.native || fs.realpathSync
  const clean = (s) => (process.platform === 'win32' ? s.replace(/:.*$/, '').replace(/[. ]+$/, '') : s)
  let cur = path.resolve(String(p || ''))
  const tail = []
  for (;;) {
    try { return path.join(real(cur), ...tail) } catch { /* não existe: sobe um nível */ }
    const parent = path.dirname(cur)
    if (parent === cur) return path.join(cur, ...tail)
    tail.unshift(clean(path.basename(cur)))
    cur = parent
  }
}

/** Protege `p` (arquivo ou pasta) de TODAS as portas de arquivo do agente. */
function protectPath(p) {
  if (p) runtimeProtected.add(nativeCanonical(p))
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

/** Está na lista fixa ou entre os protegidos em tempo de execução? */
function isListed(resolved, homedir, platform, extra = runtimeProtected) {
  for (const b of blockedList(homedir, platform)) {
    if (isWithin(resolved, b)) return true
  }
  for (const b of extra) {
    if (isWithin(resolved, b)) return true
  }
  return false
}

/** O caminho JÁ RESOLVIDO (idealmente via realpath) é proibido? `extra` são os
 *  protegidos em tempo de execução (protectPath). */
function isBlockedPath(resolved, homedir, platform, extra = runtimeProtected) {
  if (platform === 'win32' && isUncPath(resolved)) return true
  return isListed(resolved, homedir, platform, extra)
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
  const home = os.homedir()
  if (isBlockedPath(resolved, home, process.platform)) return false
  // Segunda forma, NATIVA: pega os apelidos do mesmo arquivo que o realpath JS
  // deixa passar — o nome curto 8.3 (C:\Users\JNIOR~1\.ssh driblava ~/.ssh) e o
  // `::$DATA` (driblava arquivo protegido, como ~/.env e o .env do postgres).
  // Contra ela vale só a LISTA, não a regra de UNC: o .native
  // expande unidade de rede mapeada (Z:) para \\servidor\share, e isso não é
  // alguém digitando UNC.
  const native = nativeCanonical(filePath)
  if (native !== resolved && isListed(native, nativeCanonical(home), process.platform)) return false
  return true
}

module.exports = { isUncPath, isWithin, blockedList, isBlockedPath, isPathSafe, protectPath }
