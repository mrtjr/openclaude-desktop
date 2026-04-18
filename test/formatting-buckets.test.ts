import { describe, it, expect, vi, afterEach } from 'vitest'
import { timeBucket, groupByBucket, bucketLabel } from '../src/utils/formatting'

// Freeze clock to a known moment so "today" boundary math is deterministic.
// Using a mid-day timestamp avoids timezone edge cases.
const NOW = new Date('2026-04-17T14:00:00Z').getTime()

afterEach(() => { vi.useRealTimers() })

describe('timeBucket', () => {
  it('classifies timestamps relative to start-of-today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const DAY = 86_400_000

    expect(timeBucket(now)).toBe('today')
    // 1 minute after startOfToday still counts as today
    expect(timeBucket(new Date(startOfToday.getTime() + 60_000))).toBe('today')
    // Just before startOfToday is yesterday
    expect(timeBucket(new Date(startOfToday.getTime() - 1))).toBe('yesterday')
    // 1 day ago = yesterday
    expect(timeBucket(new Date(startOfToday.getTime() - DAY + 60_000))).toBe('yesterday')
    // 5 days ago = week bucket
    expect(timeBucket(new Date(startOfToday.getTime() - 5 * DAY))).toBe('week')
    // 20 days ago = month bucket
    expect(timeBucket(new Date(startOfToday.getTime() - 20 * DAY))).toBe('month')
    // 90 days ago = older
    expect(timeBucket(new Date(startOfToday.getTime() - 90 * DAY))).toBe('older')
  })

  it('accepts Date, string, and number inputs', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(timeBucket(NOW)).toBe('today')
    expect(timeBucket(new Date(NOW))).toBe('today')
    expect(timeBucket(new Date(NOW).toISOString())).toBe('today')
  })
})

describe('groupByBucket', () => {
  it('returns buckets in chronological order (today → older)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const DAY = 86_400_000
    const items = [
      { id: 'a', createdAt: new Date(startOfToday - 100 * DAY) }, // older
      { id: 'b', createdAt: now },                                  // today
      { id: 'c', createdAt: new Date(startOfToday - 20 * DAY) },  // month
      { id: 'd', createdAt: new Date(startOfToday - 12 * 3600_000) }, // yesterday (noon yesterday)
    ]
    const groups = groupByBucket(items)
    expect(groups.map(([b]) => b)).toEqual(['today', 'yesterday', 'month', 'older'])
    expect(groups.find(([b]) => b === 'today')?.[1]).toHaveLength(1)
    expect(groups.find(([b]) => b === 'older')?.[1]).toHaveLength(1)
  })

  it('omits empty buckets', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const items = [
      { id: 'a', createdAt: new Date(NOW) },
      { id: 'b', createdAt: new Date(NOW - 60_000) },
    ]
    const groups = groupByBucket(items)
    expect(groups).toHaveLength(1)
    expect(groups[0][0]).toBe('today')
    expect(groups[0][1]).toHaveLength(2)
  })

  it('handles empty input', () => {
    expect(groupByBucket([])).toEqual([])
  })

  it('preserves input order within a bucket', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const items = [
      { id: 'first', createdAt: new Date(NOW - 1000) },
      { id: 'second', createdAt: new Date(NOW - 2000) },
      { id: 'third', createdAt: new Date(NOW - 3000) },
    ]
    const groups = groupByBucket(items)
    expect(groups[0][1].map(i => i.id)).toEqual(['first', 'second', 'third'])
  })
})

describe('bucketLabel', () => {
  it('returns Portuguese by default', () => {
    expect(bucketLabel('today')).toBe('Hoje')
    expect(bucketLabel('yesterday')).toBe('Ontem')
    expect(bucketLabel('older')).toBe('Anterior')
  })

  it('returns English when lang="en"', () => {
    expect(bucketLabel('today', 'en')).toBe('Today')
    expect(bucketLabel('week', 'en')).toBe('Previous 7 days')
  })
})
