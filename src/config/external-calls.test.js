import { describe, expect, test } from 'vitest'

import {
  EXTERNAL_CALLS,
  EXTERNAL_CALL_STATISTICS,
  METRIC_SCHEMES,
  SCHEME_BY_SERVICE
} from './external-calls.js'
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

describe('SCHEME_BY_SERVICE', () => {
  test('names the PascalCase scheme for the frontends and the dotted scheme for reference-data and dynamics-gateway', () => {
    expect(SCHEME_BY_SERVICE).toEqual({
      'trade-imports-ins-frontend': 'pascal',
      'trade-imports-animals-frontend': 'pascal',
      'trade-imports-plants-frontend': 'pascal',
      'trade-imports-reference-data': 'dotted',
      'trade-imports-dynamics-gateway': 'dotted'
    })
  })

  test('names a METRIC_SCHEMES entry for every service in EXTERNAL_CALLS', () => {
    for (const { service } of EXTERNAL_CALLS) {
      expect(Object.keys(METRIC_SCHEMES)).toContain(SCHEME_BY_SERVICE[service])
    }
  })

  test('is frozen', () => {
    expect(Object.isFrozen(SCHEME_BY_SERVICE)).toBe(true)
  })
})

describe('METRIC_SCHEMES', () => {
  test('names the PascalCase metrics with Dependency and Operation dimensions, and the dotted Micrometer metrics with dependency and operation dimensions', () => {
    expect(METRIC_SCHEMES).toEqual({
      pascal: {
        duration: 'ExternalCallDuration',
        failure: 'ExternalCallFailure',
        dependency: 'Dependency',
        operation: 'Operation'
      },
      dotted: {
        duration: 'external.call.duration',
        failure: 'external.call.failure',
        dependency: 'dependency',
        operation: 'operation'
      }
    })
  })

  test('is frozen', () => {
    expect(Object.isFrozen(METRIC_SCHEMES)).toBe(true)
    expect(Object.isFrozen(METRIC_SCHEMES.dotted)).toBe(true)
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
      ['p50Ms', 'duration', 'p50'],
      ['p95Ms', 'duration', 'p95'],
      ['p99Ms', 'duration', 'p99'],
      ['calls', 'duration', 'SampleCount'],
      ['errorRate', 'failure', 'Average']
    ])
  })
})
