import { describe, it, expect } from 'vitest'
import { isLengthTruncated, continuationPrompt } from '../src/utils/continuation'

describe('isLengthTruncated', () => {
  it('detects token-limit cutoffs across providers', () => {
    expect(isLengthTruncated('length')).toBe(true)        // OpenAI / OpenRouter / Modal
    expect(isLengthTruncated('max_tokens')).toBe(true)    // Anthropic stop_reason
    expect(isLengthTruncated('max_output_tokens')).toBe(true)
    expect(isLengthTruncated('LENGTH')).toBe(true)        // case-insensitive
  })

  it('is false for natural stops, tool calls and missing values', () => {
    expect(isLengthTruncated('stop')).toBe(false)
    expect(isLengthTruncated('end_turn')).toBe(false)
    expect(isLengthTruncated('tool_calls')).toBe(false)
    expect(isLengthTruncated('')).toBe(false)
    expect(isLengthTruncated(undefined)).toBe(false)
    expect(isLengthTruncated(null)).toBe(false)
  })
})

describe('continuationPrompt', () => {
  it('asks to resume without repeating, per language', () => {
    expect(continuationPrompt('pt')).toMatch(/de onde parou/i)
    expect(continuationPrompt('pt')).toMatch(/não repita/i)
    expect(continuationPrompt('en')).toMatch(/where it stopped/i)
    expect(continuationPrompt('en')).toMatch(/do not repeat/i)
  })
})
