import { describe, expect, test } from 'vitest'

import { scenarioThresholds, smokeThresholds } from './thresholds.js'

const SCENARIO = 'live-animals'
const ENDPOINTS = ['ins-dashboard', 'animals-backend-list']

const thresholds = scenarioThresholds(SCENARIO, ENDPOINTS)
const limitsOf = (key) => thresholds[key].map(({ threshold }) => threshold)

describe('scenarioThresholds', () => {
  test('scopes every key to the scenario', () => {
    for (const key of Object.keys(thresholds)) {
      expect(key).toContain(`scenario:${SCENARIO}`)
    }
  })

  test('scopes every response time key to an endpoint', () => {
    const durationKeys = Object.keys(thresholds).filter((key) =>
      key.startsWith('http_req_duration')
    )

    expect(durationKeys).toHaveLength(ENDPOINTS.length)

    for (const key of durationKeys) {
      expect(key).toContain('endpoint:')
    }
  })

  test('holds a page endpoint to P95 under 2000ms and P99 under 5000ms', () => {
    expect(
      limitsOf(`http_req_duration{scenario:${SCENARIO},endpoint:ins-dashboard}`)
    ).toEqual(['p(95)<2000', 'p(99)<5000'])
  })

  test('holds an api endpoint to P95 under 200ms and P99 under 1200ms', () => {
    expect(
      limitsOf(
        `http_req_duration{scenario:${SCENARIO},endpoint:animals-backend-list}`
      )
    ).toEqual(['p(95)<200', 'p(99)<1200'])
  })

  test('limits failed requests to under 1%', () => {
    expect(limitsOf(`http_req_failed{scenario:${SCENARIO}}`)).toEqual([
      'rate<0.01'
    ])
  })

  test('requires more than 99% of checks to pass', () => {
    expect(limitsOf(`checks{scenario:${SCENARIO}}`)).toEqual(['rate>0.99'])
  })

  test('aborts the run on a breach after 30s', () => {
    for (const entries of Object.values(thresholds)) {
      for (const entry of entries) {
        expect(entry).toMatchObject({
          abortOnFail: true,
          delayAbortEval: '30s'
        })
      }
    }
  })

  test('throws for an endpoint outside the catalogue', () => {
    expect(() => scenarioThresholds(SCENARIO, ['no-such-endpoint'])).toThrow(
      'Unknown endpoint "no-such-endpoint"'
    )
  })
})

describe('smokeThresholds', () => {
  const merged = smokeThresholds({
    'live-animals': { endpoints: ['ins-dashboard'] },
    'high-risk-plants': { endpoints: ['plants-dashboard'] }
  })

  test('keeps every scenario separate', () => {
    expect(Object.keys(merged)).toEqual(
      expect.arrayContaining([
        'http_req_duration{scenario:live-animals,endpoint:ins-dashboard}',
        'http_req_duration{scenario:high-risk-plants,endpoint:plants-dashboard}',
        'checks{scenario:live-animals}',
        'checks{scenario:high-risk-plants}'
      ])
    )
  })

  test('has no unscoped key, so the readiness wait is never measured', () => {
    const unscoped = ['http_req_duration', 'http_req_failed', 'checks']

    for (const key of Object.keys(merged)) {
      expect(unscoped).not.toContain(key)
      expect(key).toContain('scenario:')
    }
  })
})
