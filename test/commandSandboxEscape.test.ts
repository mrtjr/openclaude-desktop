// ─── Escapes do sandbox de comandos (v2.204.0) ──────────────────────
//
// O sandbox decide o que roda SEM pedir aprovação. Quatro caminhos deixavam
// passar coisa que a allowlist não pretendia liberar.

import { describe, it, expect } from 'vitest'
import { classifyCommand, DEFAULT_SANDBOX } from '../src/utils/commandSandbox'

const C = { ...DEFAULT_SANDBOX, enabled: true }
const v = (cmd: string) => classifyCommand(cmd, C)

describe('o que a allowlist REALMENTE pretende liberar', () => {
  it('comandos de leitura legítimos seguem liberados', () => {
    for (const c of ['git status', 'ls -la', 'cat README.md', 'npm run build', 'pwd'])
      expect(v(c), c).toBe('allow')
  })

  it('sequência de comandos permitidos continua liberada', () => {
    expect(v('ls -la; echo ok')).toBe('allow')
  })
})

describe('substituição de comando não pode viajar de carona', () => {
  it('$(...) e crases nunca são allow, mesmo sob prefixo permitido', () => {
    // 'ls $(cat ~/.ssh/id_rsa)' era ALLOW: casava o prefixo 'ls' e ninguém
    // olhava o que a substituição executava.
    for (const c of ['ls $(cat ~/.ssh/id_rsa)', 'echo $(whoami)', 'cat $(find / -name id_rsa)', 'ls `id`'])
      expect(v(c), c).not.toBe('allow')
  })
})

describe('redirecionamento transforma leitor em escritor', () => {
  it('> e >> nunca são allow', () => {
    // 'echo malicioso >> ~/.profile' era ALLOW — persistência de shell.
    for (const c of ['cat /etc/passwd > /tmp/leak', 'echo x > ~/.bashrc', 'ls >> ~/.profile'])
      expect(v(c), c).not.toBe('allow')
  })
})

describe('prefixo não pode liberar OUTRO binário', () => {
  it('binários que só compartilham o prefixo caem em ask', () => {
    // 'ls' liberava lsof; 'cat' liberava catx; 'type' liberava typeperf.
    for (const c of ['lsof -i', 'catx segredo', 'typeperf x', 'grepper x', 'dirb http://x'])
      expect(v(c), c).toBe('ask')
  })

  it('o espaço final deliberado do prefixo volta a valer', () => {
    // As entradas padrão usam 'find ' / 'grep ' / 'rg ' COM espaço, mas o
    // .trim() o descartava — 'find ' liberava `findstr /S senha`.
    expect(classifyCommand('findstr /S senha', { enabled: true, allowPrefixes: ['find '], denyPatterns: [] })).toBe('ask')
    expect(classifyCommand('find . -name x', { enabled: true, allowPrefixes: ['find '], denyPatterns: [] })).toBe('allow')
    expect(classifyCommand('lsof -i', { enabled: true, allowPrefixes: ['ls'], denyPatterns: [] })).toBe('ask')
  })
})

describe('invariantes que não podem regredir', () => {
  it('sandbox desligado nunca decide nada', () => {
    expect(classifyCommand('rm -rf /', { ...DEFAULT_SANDBOX, enabled: false })).toBe('ask')
  })
  it('deny continua tendo precedência', () => {
    expect(v('git status && rm -rf ~')).toBe('deny')
  })
})
