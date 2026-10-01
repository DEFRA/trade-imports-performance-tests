import { describe, expect, test } from 'vitest'

import {
  bucketAt,
  countAt,
  pickOne,
  valueAt,
  valueAtRandom
} from './distributions.js'

const LINES = [
  { share: 0.5, min: 1, max: 3 },
  { share: 0.3, min: 4, max: 10 },
  { share: 0.15, min: 11, max: 25 },
  { share: 0.05, min: 26, max: 50 }
]
const DOCUMENTS = [
  { share: 0.3, min: 0, max: 0 },
  { share: 0.45, min: 1, max: 1 },
  { share: 0.2, min: 2, max: 2 },
  { share: 0.05, min: 3, max: 3 }
]
const TYPES = [
  { share: 0.34, value: 'plants-for-planting' },
  { share: 0.33, value: 'potatoes' },
  { share: 0.33, value: 'wood-and-cut-trees' }
]

const range = (length) => Array.from({ length }, (_, index) => index)

const bucketCounts = (buckets, total) =>
  buckets.map(
    (bucket) =>
      range(total).filter((index) => bucketAt(index, buckets).bucket === bucket)
        .length
  )

describe('bucketAt', () => {
  test('gives each commodity-line bucket exactly its share over 20 notifications', () => {
    expect(bucketCounts(LINES, 20)).toEqual([10, 6, 3, 1])
  })

  test('gives each commodity-line bucket exactly its share over 100 notifications', () => {
    expect(bucketCounts(LINES, 100)).toEqual([50, 30, 15, 5])
  })

  test('gives each document bucket exactly its share over 20 notifications', () => {
    expect(bucketCounts(DOCUMENTS, 20)).toEqual([6, 9, 4, 1])
  })

  test('is repeatable', () => {
    expect(bucketAt(13, LINES)).toEqual(bucketAt(13, LINES))
  })
})

describe('countAt', () => {
  test('gives notification 0 three commodity lines', () => {
    expect(countAt(0, LINES)).toBe(3)
  })

  test('reaches the 50-line case within the first 8 notifications', () => {
    expect(range(8).map((index) => countAt(index, LINES))).toContain(50)
  })

  test('steps the 26-50 bucket down from 50', () => {
    const large = range(100)
      .filter((index) => bucketAt(index, LINES).bucket === LINES[3])
      .map((index) => countAt(index, LINES))

    expect(large).toEqual([50, 49, 48, 47, 46])
  })

  test('keeps every count inside its bucket', () => {
    for (const index of range(100)) {
      const { min, max } = bucketAt(index, LINES).bucket

      expect(countAt(index, LINES)).toBeGreaterThanOrEqual(min)
      expect(countAt(index, LINES)).toBeLessThanOrEqual(max)
    }
  })

  test('averages 1 document over 20 notifications and gives notification 0 one', () => {
    const counts = range(20).map((index) => countAt(index, DOCUMENTS))

    expect(counts.reduce((sum, count) => sum + count, 0) / 20).toBe(1)
    expect(counts[0]).toBe(1)
  })
})

describe('valueAt', () => {
  test('starts with plants for planting', () => {
    expect(valueAt(0, TYPES)).toBe('plants-for-planting')
  })

  test('splits 100 notifications 34, 33, 33', () => {
    const values = range(100).map((index) => valueAt(index, TYPES))

    expect(
      TYPES.map(
        ({ value }) => values.filter((chosen) => chosen === value).length
      )
    ).toEqual([34, 33, 33])
  })
})

describe('valueAtRandom', () => {
  const halves = [
    { share: 0.5, value: 'first' },
    { share: 0.5, value: 'second' }
  ]

  test.each([
    [0, 'first'],
    [0.49, 'first'],
    [0.5, 'second'],
    [0.99, 'second']
  ])('maps %s to %s', (random, expected) => {
    expect(valueAtRandom(halves, random)).toBe(expected)
  })
})

describe('pickOne', () => {
  test('picks by the random number', () => {
    expect(pickOne(['a', 'b', 'c'], 0)).toBe('a')
    expect(pickOne(['a', 'b', 'c'], 0.99)).toBe('c')
  })

  test('returns undefined for an empty list', () => {
    expect(pickOne([], 0.5)).toBeUndefined()
  })
})
