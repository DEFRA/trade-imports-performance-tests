import { describe, expect, test } from 'vitest'

import { thresholdLines, thresholdResults } from './summary-text.js'

describe('thresholdResults', () => {
  test('walks each threshold into a result, passing or failing', () => {
    expect(
      thresholdResults({
        'checks{scenario:a}': {
          thresholds: { 'rate>0.99': { ok: true }, 'rate>=0': { ok: false } }
        },
        iterations: { values: { count: 1 } }
      })
    ).toEqual([
      { metric: 'checks{scenario:a}', expression: 'rate>0.99', ok: true },
      { metric: 'checks{scenario:a}', expression: 'rate>=0', ok: false }
    ])
  })
})

describe('thresholdLines', () => {
  test('lists each threshold with its result', () => {
    expect(
      thresholdLines({
        'checks{scenario:a}': {
          thresholds: { 'rate>0.99': { ok: true }, 'rate>=0': { ok: false } }
        },
        iterations: { values: { count: 1 } }
      })
    ).toEqual([
      'Threshold checks{scenario:a} rate>0.99: passed',
      'Threshold checks{scenario:a} rate>=0: FAILED'
    ])
  })
})
