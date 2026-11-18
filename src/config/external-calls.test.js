import { describe, expect, test } from 'vitest'

import {
  EXTERNAL_CALLS,
  EXTERNAL_CALL_STATISTICS,
  METRIC_SCHEMES
} from './external-calls.js'
import { STUBBED_INTEGRATIONS } from './stub-profiles.js'

const defraIdRows = (service) => [
  {
    service,
    dependency: 'defra-id',
    operation: 'openid-configuration',
    interfaceId: null,
    scheme: 'pascal'
  },
  {
    service,
    dependency: 'defra-id',
    operation: 'jwks',
    interfaceId: 'SYN-12',
    scheme: 'pascal'
  },
  {
    service,
    dependency: 'defra-id',
    operation: 'token-exchange',
    interfaceId: 'SYN-11',
    scheme: 'pascal'
  },
  {
    service,
    dependency: 'defra-id',
    operation: 'token-refresh',
    interfaceId: 'SYN-13',
    scheme: 'pascal'
  }
]

describe('EXTERNAL_CALLS', () => {
  test('is the 16 calls the services measure, in order, each with the scheme its service publishes', () => {
    expect(EXTERNAL_CALLS).toEqual([
      ...defraIdRows('trade-imports-ins-frontend'),
      ...defraIdRows('trade-imports-animals-frontend'),
      ...defraIdRows('trade-imports-plants-frontend'),
      {
        service: 'trade-imports-reference-data',
        dependency: 'trade-token',
        operation: 'client-credentials-token',
        interfaceId: 'SYN-19',
        scheme: 'dotted'
      },
      {
        service: 'trade-imports-reference-data',
        dependency: 'mdm',
        operation: 'get-countries',
        interfaceId: 'SYN-19',
        scheme: 'dotted'
      },
      {
        service: 'trade-imports-reference-data',
        dependency: 'mdm',
        operation: 'get-ports-of-entry',
        interfaceId: 'SYN-19',
        scheme: 'dotted'
      },
      {
        service: 'trade-imports-dynamics-gateway',
        dependency: 'azure-service-bus',
        operation: 'send-message',
        interfaceId: null,
        scheme: 'dotted'
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

  test('names only schemes METRIC_SCHEMES holds', () => {
    for (const { scheme } of EXTERNAL_CALLS) {
      expect(Object.keys(METRIC_SCHEMES)).toContain(scheme)
    }
  })

  test('is frozen', () => {
    expect(Object.isFrozen(EXTERNAL_CALLS)).toBe(true)
    expect(Object.isFrozen(EXTERNAL_CALLS[0])).toBe(true)
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
