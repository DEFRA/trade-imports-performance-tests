import { describe, expect, test } from 'vitest'

import { ENDPOINTS } from './endpoints.js'
import {
  JOURNEYS,
  SCENARIOS,
  resolvePassword,
  smokeScenarios
} from './smoke.js'

const MAX_SMOKE_VUS = 5

const withoutPrefix = (endpoint, prefix) =>
  endpoint.startsWith(`${prefix}-`)
    ? endpoint.slice(prefix.length + 1)
    : endpoint

describe('SCENARIOS', () => {
  test('uses at most 5 virtual users in total', () => {
    const total = Object.values(SCENARIOS).reduce(
      (sum, { vus }) => sum + vus,
      0
    )

    expect(total).toBeLessThanOrEqual(MAX_SMOKE_VUS)
  })

  test('has the front door and both journeys', () => {
    expect(Object.keys(SCENARIOS)).toEqual([
      'ins-front-door',
      'live-animals',
      'high-risk-plants'
    ])
  })

  test('only lists endpoints that are in the catalogue', () => {
    for (const { endpoints } of Object.values(SCENARIOS)) {
      for (const endpoint of endpoints) {
        expect(Object.keys(ENDPOINTS)).toContain(endpoint)
      }
    }
  })

  test('gives both journeys the same endpoint shape, prefix aside', () => {
    const shapeOf = (scenario) => {
      const { endpointPrefix, savePageEndpoint } = JOURNEYS[scenario]

      return SCENARIOS[scenario].endpoints.map((endpoint) =>
        withoutPrefix(endpoint, endpointPrefix).replace(
          savePageEndpoint.slice(endpointPrefix.length + 1),
          'save-page'
        )
      )
    }

    expect(shapeOf('live-animals')).toEqual(shapeOf('high-risk-plants'))
  })
})

describe('smokeScenarios', () => {
  test('gives every scenario a constant-VU executor with the configured duration', () => {
    const scenarios = smokeScenarios()

    expect(Object.keys(scenarios)).toEqual(Object.keys(SCENARIOS))

    for (const [name, scenario] of Object.entries(scenarios)) {
      expect(scenario).toMatchObject({
        executor: 'constant-vus',
        vus: SCENARIOS[name].vus,
        duration: '2m',
        exec: SCENARIOS[name].exec
      })
    }
  })
})

describe('resolvePassword', () => {
  test('uses AUTH_PASSWORD when set', () => {
    expect(resolvePassword({ AUTH_PASSWORD: ' secret ' })).toBe('secret')
  })

  test.each([{}, { AUTH_PASSWORD: '' }, { AUTH_PASSWORD: '  ' }])(
    'falls back to the stub default: %o',
    (env) => {
      expect(resolvePassword(env)).toBe('Password123')
    }
  )
})
