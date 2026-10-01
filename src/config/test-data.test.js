import { describe, expect, test } from 'vitest'

import { PLANT_ORIGINS_BY_COMMODITY_TYPE, standInCaveat } from './test-data.js'

describe('standInCaveat', () => {
  test('names floci and cdp-uploader for a local run', () => {
    expect(standInCaveat('local')).toContain('floci')
    expect(standInCaveat('local')).toContain('cdp-uploader')
  })

  test.each(['dev', 'test', 'perf-test'])('has none for %s', (environment) => {
    expect(standInCaveat(environment)).toBeUndefined()
  })
})

describe('PLANT_ORIGINS_BY_COMMODITY_TYPE', () => {
  test.each([
    ['potatoes', 4],
    ['wood-and-cut-trees', 4],
    ['plants-for-planting', 27]
  ])('allows %s %s origin codes', (type, count) => {
    expect(PLANT_ORIGINS_BY_COMMODITY_TYPE[type]).toHaveLength(count)
  })
})
