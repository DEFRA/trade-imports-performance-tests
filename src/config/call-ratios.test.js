import { describe, expect, test } from 'vitest'

import {
  CALL_COUNTS_PATH,
  CALL_COUNT_JOURNEYS,
  DERIVED_CALL_RATIOS,
  PAGE_REQUEST_METRICS,
  PAGE_REQUEST_SERVICES
} from './call-ratios.js'
import { JOURNEYS } from './smoke.js'

describe('call ratio configuration', () => {
  test('reads the endpoint the frontends serve', () => {
    expect(CALL_COUNTS_PATH).toBe('/call-counts')
  })

  test('names both journeys, each with its own frontend', () => {
    expect(CALL_COUNT_JOURNEYS).toEqual({
      'live-animals': {
        service: JOURNEYS['live-animals'].frontend,
        urlKey: 'animalsFrontend'
      },
      'high-risk-plants': {
        service: JOURNEYS['high-risk-plants'].frontend,
        urlKey: 'plantsFrontend'
      }
    })
  })

  test('lists a CloudWatch service for each journey', () => {
    expect(PAGE_REQUEST_SERVICES).toEqual([
      { journey: 'live-animals', service: 'trade-imports-animals-frontend' },
      { journey: 'high-risk-plants', service: 'trade-imports-plants-frontend' }
    ])
  })

  test('derives D2 and D3 as one a page plus one a backend call, D1 as one a page', () => {
    expect(DERIVED_CALL_RATIOS.d1).toMatchObject({
      perPage: 1,
      perBackendCall: 0
    })
    expect(DERIVED_CALL_RATIOS.d2).toMatchObject({
      perPage: 1,
      perBackendCall: 1
    })
    expect(DERIVED_CALL_RATIOS.d3).toMatchObject({
      perPage: 1,
      perBackendCall: 1
    })
  })

  test('names the per-page-request metric dimension', () => {
    expect(PAGE_REQUEST_METRICS.dimension).toEqual({
      Name: 'RequestKind',
      Value: 'page'
    })
  })

  test('is frozen', () => {
    expect(Object.isFrozen(CALL_COUNT_JOURNEYS['live-animals'])).toBe(true)
  })
})
