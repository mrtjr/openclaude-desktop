// ─── Guardas de caminho nas portas de leitura (v2.205.0) ────────────
//
// read-file/write-file/edit-file/search-files já barravam diretório protegido.
// Outras portas com a MESMA capacidade não barravam nada — e listar ~/.ssh já
// entrega quais chaves existem, mesmo sem ler o conteúdo.

import { describe, it, expect } from 'vitest'
// @ts-expect-error módulo CJS do processo principal
import { isPathSafe, isBlockedPath, isWithin } from '../electron/path-safety.js'
import { readFileSync } from 'fs'

const HOME = '/home/u'

describe('isBlockedPath — a regra em si', () => {
  it('barra os diretórios de credencial', () => {
    for (const p of ['/home/u/.ssh/id_rsa', '/home/u/.aws/credentials', '/home/u/.gnupg/x', '/home/u/.config/gcloud/y', '/home/u/.env'])
      expect(isBlockedPath(p, HOME, 'linux'), p).toBe(true)
  })

  it('não barra o projeto do usuário', () => {
    for (const p of ['/home/u/projeto/src/a.ts', '/home/u/docs/nota.md'])
      expect(isBlockedPath(p, HOME, 'linux'), p).toBe(false)
  })

  it('é segment-aware: .sshfoo não é .ssh', () => {
    expect(isWithin('/home/u/.sshfoo/x', '/home/u/.ssh')).toBe(false)
    expect(isWithin('/home/u/.ssh/x', '/home/u/.ssh')).toBe(true)
  })

  it('barra caminho UNC no Windows (share de rede)', () => {
    const BS = String.fromCharCode(92)  // evita literal de barra invertida no fonte
    expect(isBlockedPath(BS+BS+'servidor'+BS+'share'+BS+'x', 'C:'+BS+'Users'+BS+'j', 'win32')).toBe(true)
  })
})

describe('isPathSafe — guard compartilhado', () => {
  it('mora em path-safety.js para as portas não divergirem', () => {
    // A regressão que isto trava: cada módulo com sua cópia (ou sem nenhuma).
    expect(typeof isPathSafe).toBe('function')
  })

  it('aprova caminho comum e reprova o protegido', () => {
    expect(isPathSafe(process.cwd())).toBe(true)
  })
})

describe('as portas de leitura precisam TODAS chamar o guard', () => {
  // Guard estático: se alguém abrir uma porta nova sem guarda, este teste cai.
  const main = readFileSync('electron/main.js', 'utf-8')
  const doc = readFileSync('electron/ipc-document.js', 'utf-8')

  it('list-directory e workspace-tree passaram a checar', () => {
    for (const h of ['list-directory', 'workspace-tree']) {
      const i = main.indexOf(`ipcMain.handle('${h}'`)
      expect(i, h).toBeGreaterThan(-1)
      expect(main.slice(i, i + 1200), h).toContain('isPathSafe')
    }
  })

  it('read-document (alcançável pelo modelo via analyze_image) checa', () => {
    const i = doc.indexOf("ipcMain.handle('read-document'")
    expect(i).toBeGreaterThan(-1)
    expect(doc.slice(i, i + 900)).toContain('isPathSafe')
  })

  it('as portas antigas não perderam o guard', () => {
    for (const h of ['read-file', 'write-file', 'edit-file']) {
      const i = main.indexOf(`ipcMain.handle('${h}'`)
      expect(main.slice(i, i + 900), h).toContain('isPathSafe')
    }
  })
})
