import { describe, it, expect } from 'vitest'
import { maskSecrets } from '../src/utils/securityAudit'

describe('maskSecrets', () => {
  it('should mask OpenAI API key', () => {
    const input = 'My key is sk-proj-12345ABCD67890efgh1234567890'
    const expected = 'My key is sk-***'
    expect(maskSecrets(input)).toBe(expected)
  })

  it('should mask Anthropic API key', () => {
    const input = 'Anthropic key: sk-ant-api03-abcdefGHIJKL-1234567890ABCDEF'
    const expected = 'Anthropic key: sk-ant-api***'
    expect(maskSecrets(input)).toBe(expected)
  })

  it('should mask Google Gemini and Bearer mixed with text', () => {
    const input = 'Normal text with Gemini AIzaSy1234567890abcdefghijklmnopqrstuvw and a Bearer abcde1234567890ABCDEF mixed.'
    const expected = 'Normal text with Gemini AIza*** and a Bearer *** mixed.'
    expect(maskSecrets(input)).toBe(expected)
  })

  it('should not alter legitimate safe text', () => {
    const input = 'This is a completely safe string without any secrets!'
    expect(maskSecrets(input)).toBe(input)
  })
})
