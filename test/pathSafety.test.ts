import { describe, it, expect } from 'vitest'
// @ts-ignore — CJS helper
import { isUncPath, isWithin, isBlockedPath, blockedList } from '../electron/path-safety.js'

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
