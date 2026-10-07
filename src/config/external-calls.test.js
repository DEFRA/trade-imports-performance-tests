import { describe, expect, test } from 'vitest'

import { EXTERNAL_CALLS, EXTERNAL_CALL_STATISTICS } from './external-calls.js'
import { STUBBED_INTEGRATIONS } from './stub-profiles.js'

const defraIdRows = (service) => [
  {
    service,
    dependency: 'defra-id',
    operation: 'openid-configuration',
    interfaceId: null
  },
  {
    service,
    dependency: 'defra-id',
    operation: 'jwks',
    interfaceId: 'SYN-12'
  },
  {
    service,
    dependency: 'defra-id',
    operation: 'token-exchange',
    interfaceId: 'SYN-11'
  },
  {
    service,
    dependency: 'defra-id',
    operation: 'token-refresh',
    interfaceId: 'SYN-13'
  }
]

describe('EXTERNAL_CALLS', () => {
  test('is the 16 calls the services measure, in order', () => {
    expect(EXTERNAL_CALLS).toEqual([
      ...defraIdRows('trade-imports-ins-frontend'),
      ...defraIdRows('trade-imports-animals-frontend'),
      ...defraIdRows('trade-imports-plants-frontend'),
      {
        service: 'trade-imports-reference-data',
        dependency: 'trade-token',
        operation: 'client-credentials-token',
        interfaceId: 'SYN-19'
      },
      {
        service: 'trade-imports-reference-data',
        dependency: 'mdm',
        operation: 'get-countries',
        interfaceId: 'SYN-19'
      },
      {
        service: 'trade-imports-reference-data',
        dependency: 'mdm',
        operation: 'get-ports-of-entry',
        interfaceId: 'SYN-19'
      },
      {
        service: 'trade-imports-dynamics-gateway',
        dependency: 'azure-service-bus',
        operation: 'send-message',
        interfaceId: null
      }
    ])
    expect(EXTERNAL_CALLS).toHaveLength(16)
  })

  test('has no two rows with the same service, dependency and operation', () => {
    const keys = EXTERNAL_CALLS.map(
      ({ service, dependency, operation }) =>
        `${service}/${dependency}/${operation}`
    )

    expect(new Set(keys).size).toBe(keys.length)
  })

  test('names only stubbed integrations, never SNS, SQS or cdp-uploader', () => {
    const integrations = STUBBED_INTEGRATIONS.map(
      ({ integration }) => integration
    )

    for (const { dependency } of EXTERNAL_CALLS) {
      expect(integrations).toContain(dependency)
    }
  })

  test('is frozen', () => {
    expect(Object.isFrozen(EXTERNAL_CALLS)).toBe(true)
    expect(Object.isFrozen(EXTERNAL_CALLS[0])).toBe(true)
  })
})

describe('EXTERNAL_CALL_STATISTICS', () => {
  test('reads p50, p95, p99 and the call count from the duration and the error rate from the failure metric', () => {
    expect(
      EXTERNAL_CALL_STATISTICS.map(({ key, metric, stat }) => [
        key,
        metric,
        stat
      ])
    ).toEqual([
      ['p50Ms', 'ExternalCallDuration', 'p50'],
      ['p95Ms', 'ExternalCallDuration', 'p95'],
      ['p99Ms', 'ExternalCallDuration', 'p99'],
      ['calls', 'ExternalCallDuration', 'SampleCount'],
      ['errorRate', 'ExternalCallFailure', 'Average']
    ])
  })
})
