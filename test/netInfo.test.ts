import { describe, it, expect } from 'vitest'
import { isTailscale, pickLocalAddresses } from '../electron/net-info.js'

describe('isTailscale', () => {
  it('matches the Tailscale CGNAT range 100.64.0.0/10', () => {
    expect(isTailscale('100.64.0.1', 'eth0')).toBe(true)
    expect(isTailscale('100.100.50.2', 'eth0')).toBe(true)
    expect(isTailscale('100.127.255.254', 'eth0')).toBe(true)
  })
  it('does NOT match 100.x outside the CGNAT range', () => {
    expect(isTailscale('100.0.0.1', 'eth0')).toBe(false)   // 100.0 < 100.64
    expect(isTailscale('100.63.0.1', 'eth0')).toBe(false)  // just below
    expect(isTailscale('100.128.0.1', 'eth0')).toBe(false) // just above
    expect(isTailscale('192.168.0.5', 'eth0')).toBe(false)
  })
  it('matches by interface name regardless of address', () => {
    expect(isTailscale('192.168.1.2', 'Tailscale')).toBe(true)
    expect(isTailscale('10.0.0.1', 'tailscale0')).toBe(true)
  })
})

describe('pickLocalAddresses', () => {
  it('keeps only non-internal IPv4 and drops loopback/IPv6', () => {
    const ifaces = {
      lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      eth0: [
        { family: 'IPv4', address: '192.168.0.10', internal: false },
        { family: 'IPv6', address: 'fe80::1', internal: false },
      ],
    }
    const r = pickLocalAddresses(ifaces as any)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ address: '192.168.0.10', tailscale: false })
  })
  it('sorts Tailscale addresses first (the recommended one for remote access)', () => {
    const ifaces = {
      eth0: [{ family: 'IPv4', address: '192.168.0.10', internal: false }],
      tailscale0: [{ family: 'IPv4', address: '100.100.1.1', internal: false }],
    }
    const r = pickLocalAddresses(ifaces as any)
    expect(r[0].tailscale).toBe(true)
    expect(r[0].address).toBe('100.100.1.1')
    expect(r[1].tailscale).toBe(false)
  })
  it('handles empty / missing input safely', () => {
    expect(pickLocalAddresses({} as any)).toEqual([])
    expect(pickLocalAddresses(null as any)).toEqual([])
  })
})
