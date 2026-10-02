import { describe, expect, test } from 'vitest'

import { phaseAt, phaseEntryAt, wallSecondsFor } from './phases.js'

const SCHEDULE = [
  { phase: 'warm-up', startSeconds: 0, endSeconds: 100, paceFactor: 1 },
  { phase: 'peak', startSeconds: 100, endSeconds: 200, paceFactor: 1 },
  { phase: 'burst', startSeconds: 200, endSeconds: 260, paceFactor: 1.5 },
  { phase: 'tail', startSeconds: 260, endSeconds: null, paceFactor: 1 }
]

describe('phaseAt', () => {
  test.each([
    [0, 'warm-up'],
    [99.9, 'warm-up'],
    [100, 'peak'],
    [200, 'burst'],
    [259, 'burst'],
    [260, 'tail'],
    [100_000, 'tail']
  ])('is the phase at %s seconds: %s', (elapsed, phase) => {
    expect(phaseAt(SCHEDULE, elapsed)).toBe(phase)
  })

  test('is the first phase before 0', () => {
    expect(phaseAt(SCHEDULE, -5)).toBe('warm-up')
  })
})

describe('phaseEntryAt', () => {
  test('returns the whole entry, with its pace factor', () => {
    expect(phaseEntryAt(SCHEDULE, 230).paceFactor).toBe(1.5)
  })
})

describe('wallSecondsFor', () => {
  test('takes the same seconds when every phase runs at pace 1', () => {
    expect(wallSecondsFor(30, 10, SCHEDULE.slice(0, 2))).toBe(30)
  })

  test('shortens a wait that starts 10 seconds before the burst', () => {
    expect(wallSecondsFor(30, 190, SCHEDULE)).toBeCloseTo(23.33, 2)
  })

  test('takes 20 seconds for a 30 second wait inside the burst with 60 left', () => {
    expect(wallSecondsFor(30, 200, SCHEDULE)).toBe(20)
  })

  test('takes the same seconds for a wait that starts in the open-ended tail', () => {
    expect(wallSecondsFor(30, 300, SCHEDULE)).toBe(30)
  })

  test('takes no time for no think time', () => {
    expect(wallSecondsFor(0, 210, SCHEDULE)).toBe(0)
  })

  test('crosses the whole burst: 120 seconds from its start takes 60 plus 30', () => {
    expect(wallSecondsFor(120, 200, SCHEDULE)).toBe(90)
  })
})
