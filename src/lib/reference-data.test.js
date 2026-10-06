import { describe, expect, test } from 'vitest'

import {
  INITIAL_WATCH_STATE,
  cacheClassOf,
  expectedExpiries,
  mdmAnsweredCount,
  nextWatchState
} from './reference-data.js'

describe('mdmAnsweredCount', () => {
  test('reads the answered count of the mdm integration', () => {
    expect(
      mdmAnsweredCount({
        integrations: [
          { integration: 'defra-id', answered: { count: 3 } },
          { integration: 'mdm', answered: { count: 7 } }
        ]
      })
    ).toBe(7)
  })

  test.each([
    ['no integrations list', {}],
    ['no mdm entry', { integrations: [{ integration: 'defra-id' }] }],
    [
      'a count that is not a number',
      { integrations: [{ integration: 'mdm', answered: { count: 'many' } }] }
    ],
    ['no report at all', null]
  ])('gives null for %s', (_name, report) => {
    expect(mdmAnsweredCount(report)).toBeNull()
  })
})

describe('cacheClassOf', () => {
  test.each([
    [5, 6, 'cold'],
    [6, 6, 'warm'],
    [null, 6, 'unclassified'],
    [6, null, 'unclassified']
  ])('from %s to %s is %s', (before, after, expected) => {
    expect(cacheClassOf({ before, after })).toBe(expected)
  })
})

describe('nextWatchState', () => {
  test('marks the first read of an endpoint, and not the second', () => {
    const first = nextWatchState(INITIAL_WATCH_STATE, {
      endpoint: 'reference-data-countries',
      count: 4
    })
    const second = nextWatchState(first.state, {
      endpoint: 'reference-data-countries',
      count: 4
    })

    expect(first.isFirstRead).toBe(true)
    expect(first.state).toEqual({
      previousCount: 4,
      seen: ['reference-data-countries']
    })
    expect(second.isFirstRead).toBe(false)
  })

  test('treats a different endpoint as its own first read', () => {
    const first = nextWatchState(INITIAL_WATCH_STATE, {
      endpoint: 'reference-data-countries',
      count: 4
    })

    expect(
      nextWatchState(first.state, {
        endpoint: 'reference-data-ports-of-entry',
        count: 5
      }).isFirstRead
    ).toBe(true)
  })
})

describe('expectedExpiries', () => {
  test('counts the whole cache lifetimes in a watch', () => {
    expect(expectedExpiries({ watchSeconds: 14_430, cacheMinutes: 60 })).toBe(4)
  })

  test('is 0 for a watch shorter than the cache lifetime', () => {
    expect(expectedExpiries({ watchSeconds: 1770, cacheMinutes: 60 })).toBe(0)
  })
})
