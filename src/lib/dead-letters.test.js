import { describe, expect, test } from 'vitest'

import { deadLetterGrowth, deadLetterLine } from './dead-letters.js'

describe('deadLetterGrowth', () => {
  test.each([
    [0, 0, 0],
    [2, 5, 3],
    [5, 2, 0]
  ])('from %i to %i is %i', (before, after, growth) => {
    expect(deadLetterGrowth({ before, after })).toBe(growth)
  })

  test.each([
    [null, 3],
    [3, null],
    [null, null]
  ])('is null when a reading is missing: %s then %s', (before, after) => {
    expect(deadLetterGrowth({ before, after })).toBeNull()
  })
})

describe('deadLetterLine', () => {
  test('states no cascade when the queue did not grow', () => {
    expect(deadLetterLine({ before: 0, after: 0 })).toBe(
      "Service Bus stand-in: the gateway's dead-letter queue held 0 messages at the start and 0 at the end: no cascade"
    )
  })

  test('states the cascade when the queue grew', () => {
    expect(deadLetterLine({ before: 1, after: 4 })).toBe(
      "Service Bus stand-in: the gateway's dead-letter queue held 1 message at the start and 4 at the end: CASCADED, 3 more"
    )
  })

  test('says it could not measure when a reading is missing', () => {
    expect(deadLetterLine({ before: null, after: 0 })).toBe(
      "Service Bus stand-in: not measured, the gateway's dead-letter queue could not be read"
    )
  })
})
