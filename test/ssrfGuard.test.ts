import { describe, it, expect } from 'vitest'
// @ts-ignore — CJS helper
import { ipToBlockReason, isBlockedIp, hostnameBlockReason } from '../electron/ssrf-guard.js'

describe('ipToBlockReason — IPv4', () => {
  it('bloqueia loopback/privado/link-local/cgnat/reservado', () => {
    expect(ipToBlockReason('127.0.0.1')).toBe('loopback')
    expect(ipToBlockReason('10.0.0.5')).toBe('private')
    expect(ipToBlockReason('172.16.3.4')).toBe('private')
    expect(ipToBlockReason('172.31.255.1')).toBe('private')
    expect(ipToBlockReason('192.168.1.1')).toBe('private')
    expect(ipToBlockReason('169.254.169.254')).toBe('link-local') // metadata de nuvem
    expect(ipToBlockReason('100.64.0.1')).toBe('cgnat')
    expect(ipToBlockReason('224.0.0.1')).toBe('reserved')
    expect(ipToBlockReason('0.0.0.0')).toBe('unspecified')
  })
  it('libera IP público', () => {
    expect(ipToBlockReason('8.8.8.8')).toBeNull()
    expect(ipToBlockReason('1.1.1.1')).toBeNull()
    expect(ipToBlockReason('172.15.0.1')).toBeNull() // fora de 16-31
    expect(ipToBlockReason('172.32.0.1')).toBeNull()
  })
})

describe('ipToBlockReason — IPv6 (incl. mapeado)', () => {
  it('bloqueia loopback/link-local/unique-local e ::ffff mapeado', () => {
    expect(ipToBlockReason('::1')).toBe('loopback')
    expect(ipToBlockReason('fe80::1')).toBe('link-local')
    expect(ipToBlockReason('fc00::1')).toBe('unique-local')
    expect(ipToBlockReason('fd12::34')).toBe('unique-local')
    expect(ipToBlockReason('::ffff:127.0.0.1')).toBe('loopback')
  })
  it('libera IPv6 público', () => {
    expect(ipToBlockReason('2606:4700:4700::1111')).toBeNull()
  })
})

describe('hostnameBlockReason', () => {
  it('bloqueia localhost e variantes', () => {
    expect(hostnameBlockReason('localhost')).toBe('localhost')
    expect(hostnameBlockReason('admin.localhost')).toBe('localhost')
  })
  it('classifica IP literal no host', () => {
    expect(hostnameBlockReason('127.0.0.1')).toBe('loopback')
    expect(hostnameBlockReason('[::1]')).toBe('loopback')
  })
  it('hostname público comum → null (decidido via DNS depois)', () => {
    expect(hostnameBlockReason('example.com')).toBeNull()
    expect(hostnameBlockReason('api.github.com')).toBeNull()
  })
  it('isBlockedIp espelha ipToBlockReason', () => {
    expect(isBlockedIp('10.0.0.1')).toBe(true)
    expect(isBlockedIp('8.8.8.8')).toBe(false)
  })
})
