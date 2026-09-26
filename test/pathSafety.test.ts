import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// @ts-ignore — CJS helper
import { isUncPath, isWithin, isBlockedPath, blockedList, isPathSafe, protectPath } from '../electron/path-safety.js'

describe('isUncPath', () => {
  it('detecta UNC do Windows', () => {
    expect(isUncPath('\\\\server\\share\\x')).toBe(true)
    expect(isUncPath('//server/share')).toBe(true)
    expect(isUncPath('C:\\Users\\x')).toBe(false)
    expect(isUncPath('/home/u/x')).toBe(false)
  })
})

describe('isWithin — segment-aware (corrige o falso-positivo do startsWith)', () => {
  it('casa igualdade e descendentes', () => {
    expect(isWithin('/home/u/.ssh', '/home/u/.ssh')).toBe(true)
    expect(isWithin('/home/u/.ssh/id_rsa', '/home/u/.ssh')).toBe(true)
    expect(isWithin('C:\\Users\\u\\.ssh\\id_rsa', 'C:\\Users\\u\\.ssh')).toBe(true)
  })
  it('NÃO casa irmão com prefixo textual (.sshfoo não é .ssh)', () => {
    expect(isWithin('/home/u/.sshfoo', '/home/u/.ssh')).toBe(false)
    expect(isWithin('/home/u/.config/gitignore', '/home/u/.config/git')).toBe(false)
  })
  it('é case-insensitive e ignora barra final', () => {
    expect(isWithin('/HOME/U/.SSH/', '/home/u/.ssh')).toBe(true)
  })
})

describe('isBlockedPath', () => {
  const home = '/home/u'
  it('bloqueia segredos e arquivos sensíveis (POSIX)', () => {
    expect(isBlockedPath('/home/u/.ssh/id_rsa', home, 'linux')).toBe(true)
    expect(isBlockedPath('/home/u/.aws/credentials', home, 'linux')).toBe(true)
    expect(isBlockedPath('/etc/shadow', home, 'linux')).toBe(true)
    expect(isBlockedPath('/etc/sudoers.d/x', home, 'linux')).toBe(true)
    expect(isBlockedPath('/root/.bashrc', home, 'linux')).toBe(true)
  })
  it('libera caminhos normais do usuário', () => {
    expect(isBlockedPath('/home/u/projeto/src/index.ts', home, 'linux')).toBe(false)
    expect(isBlockedPath('/home/u/.sshfoo/x', home, 'linux')).toBe(false)
  })
  it('Windows: bloqueia System32 e UNC', () => {
    expect(isBlockedPath('C:\\Windows\\System32\\drivers', 'C:\\Users\\u', 'win32')).toBe(true)
    expect(isBlockedPath('\\\\server\\share\\secrets', 'C:\\Users\\u', 'win32')).toBe(true)
    expect(isBlockedPath('C:\\Users\\u\\proj\\a.ts', 'C:\\Users\\u', 'win32')).toBe(false)
  })
  it('blockedList inclui git config e .env do home', () => {
    const list = blockedList('/home/u', 'linux').join('|').replace(/\\/g, '/')
    expect(list).toContain('/home/u/.config/git')
    expect(list).toContain('/home/u/.env')
  })
})

describe('protectPath + forma nativa (.env da DATABASE_URL do postgres_query)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-ps-'))
  const secret = join(dir, '.env')
  writeFileSync(secret, 'DATABASE_URL=postgres://u:p@h/db')
  protectPath(secret)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('bloqueia o arquivo protegido, inclusive por caixa e traversal', () => {
    expect(isPathSafe(secret)).toBe(false)
    expect(isPathSafe(join(dir, '.ENV'))).toBe(false)
    expect(isPathSafe(join(dir, 'sub', '..', '.env'))).toBe(false)
  })

  it('não bloqueia vizinhos nem a pasta', () => {
    expect(isPathSafe(join(dir, '.env.example'))).toBe(true)
    expect(isPathSafe(dir)).toBe(true)
  })

  it.runIf(process.platform === 'win32')('Windows: stream NTFS (::$DATA) não dribla', () => {
    // fs.readFileSync('.env::$DATA') lê o próprio .env; o realpath JS mantinha o sufixo
    expect(isPathSafe(secret + '::$DATA')).toBe(false)
    expect(isPathSafe(secret + ':x')).toBe(false)
  })

  const t = tmpdir(), tl = realpathSync.native(t)
  it.runIf(process.platform === 'win32' && t.toLowerCase() !== tl.toLowerCase())('Windows: nome curto 8.3 não dribla', () => {
    // protegido pela forma que o tmpdir deu; acessado pela OUTRA (curta ↔ longa)
    const other = secret.toLowerCase().startsWith(t.toLowerCase()) ? tl + secret.slice(t.length) : t + secret.slice(tl.length)
    expect(isPathSafe(other)).toBe(false)
  })

  it('isBlockedPath aceita a lista extra explícita (puro)', () => {
    expect(isBlockedPath('/srv/app/.env', '/home/u', 'linux', new Set(['/srv/app/.env']))).toBe(true)
    expect(isBlockedPath('/srv/app/.env', '/home/u', 'linux', new Set())).toBe(false)
  })
})
