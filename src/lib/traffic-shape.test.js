import { describe, expect, test } from 'vitest'

import { chunkEvenly, reEditPlan, thinkSeconds } from './traffic-shape.js'

const range = (length) => Array.from({ length }, (_, index) => index)

describe('chunkEvenly', () => {
  test.each([
    [12, 2, [6, 6]],
    [13, 2, [7, 6]],
    [5, 3, [2, 2, 1]]
  ])('splits %s items into %s chunks of %j', (items, count, sizes) => {
    expect(
      chunkEvenly(range(items), count).map((chunk) => chunk.length)
    ).toEqual(sizes)
  })

  test('keeps the order', () => {
    expect(chunkEvenly(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })

  test('returns the whole list for one chunk', () => {
    expect(chunkEvenly(['a', 'b', 'c'], 1)).toEqual([['a', 'b', 'c']])
  })
})

describe('thinkSeconds', () => {
  test('runs from half the mean to one and a half times it', () => {
    expect(thinkSeconds(10, 0)).toBe(5)
    expect(thinkSeconds(10, 0.999)).toBeCloseTo(15, 1)
  })
})

describe('reEditPlan', () => {
  test('round-robins the steps until the target is reached', () => {
    expect(reEditPlan(['a', 'b', 'c'], 30, 40)).toEqual([
      'a',
      'b',
      'c',
      'a',
      'b'
    ])
  })

  test('rounds a part re-edit up', () => {
    expect(reEditPlan(['a', 'b'], 39, 40)).toEqual(['a'])
  })

  test.each([
    [40, 40],
    [45, 40]
  ])('is empty at %s pages when the target is %s', (soFar, target) => {
    expect(reEditPlan(['a', 'b'], soFar, target)).toEqual([])
  })

  test('counts the pages one re-edit makes', () => {
    expect(reEditPlan(['a'], 0, 9, 3)).toEqual(['a', 'a', 'a'])
  })
})
